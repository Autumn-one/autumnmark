import { app, ipcMain, BrowserWindow, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import type { UpdateState } from '@shared/types/ipc'
import { isPortableUpdatable, isUpdatable } from './utils/isUpdatable'
import {
  checkPortableUpdate,
  discardPortableFiles,
  downloadPortableUpdate,
  preparePortableInstall,
  type PortableDownload
} from './portableUpdates'

const CHECK_INTERVAL_MS = 20 * 60 * 1000
const listeners = new Set<WebContents>()
let state: UpdateState = { phase: 'idle' }
let busy = false
let announceDownload = false
let pendingDialog: WebContents | 'any' | undefined
let timer: ReturnType<typeof setInterval> | undefined
let portableDownload: PortableDownload | undefined
let pendingPortableInstall: Awaited<ReturnType<typeof preparePortableInstall>> | undefined

autoUpdater.allowPrerelease = false
autoUpdater.autoDownload = false
// Prefetching a package must not turn a normal exit into consent to install it.
autoUpdater.autoInstallOnAppQuit = false

const publish = (next: UpdateState): void => {
  state = next
  for (const listener of listeners) listener.send('mt::update-state', state)
}

const showDialog = (win: BrowserWindow | null): void => {
  const target = win && !win.isDestroyed() ? win.webContents : listeners.values().next().value
  if (target && listeners.has(target)) {
    target.send('mt::update-state', state, true)
  } else {
    pendingDialog = target ?? 'any'
  }
}

ipcMain.on('mt::update-listen', ({ sender }) => {
  if (!listeners.has(sender)) {
    listeners.add(sender)
    sender.once('destroyed', () => {
      listeners.delete(sender)
      if (pendingDialog === sender) pendingDialog = 'any'
    })
  }
  const show = pendingDialog === 'any' || pendingDialog === sender
  if (show) pendingDialog = undefined
  sender.send('mt::update-state', state, show)
})

autoUpdater.on('download-progress', ({ transferred, total, bytesPerSecond }) => {
  if (state.phase === 'downloading') {
    publish({ ...state, progress: { transferred, total, bytesPerSecond } })
  }
})

const reportInstallError = (error: unknown): void => {
  if (state.phase === 'installing') {
    log.warn('Update installation failed:', error)
    publish({ phase: 'error', stage: 'install', version: state.version })
  }
}
// Platform installers can report launch errors after quitAndInstall returns.
autoUpdater.on('error', reportInstallError)

const installPortableUpdate = async(): Promise<void> => {
  try {
    if (!portableDownload) throw new Error('No portable update has been downloaded')
    pendingPortableInstall = await preparePortableInstall(portableDownload)
    app.quit()
  } catch (error) {
    pendingPortableInstall?.cancel()
    pendingPortableInstall = undefined
    reportInstallError(error)
  }
}

ipcMain.on('app-quit-canceled', () => {
  if (!pendingPortableInstall || state.phase !== 'installing') return
  pendingPortableInstall.cancel()
  pendingPortableInstall = undefined
  publish({ phase: 'ready', version: state.version })
})

ipcMain.on('mt::update-install', (_event, version: string) => {
  if (state.phase !== 'ready' && !(state.phase === 'error' && state.stage === 'install')) return
  if (!version || state.version !== version) return
  publish({ phase: 'installing', version })
  if (isPortableUpdatable()) {
    void installPortableUpdate()
    return
  }
  try {
    autoUpdater.quitAndInstall()
  } catch (error) {
    reportInstallError(error)
  }
})

ipcMain.on('mt::update-background', () => {
  announceDownload = false
  pendingDialog = undefined
})

const runCheck = async(automatic: boolean, getWindow: () => BrowserWindow | null): Promise<void> => {
  const previous = state
  const cached = previous.phase === 'ready' || (previous.phase === 'error' && previous.stage === 'install')
  if (!automatic) {
    announceDownload = false
    if (!cached && state.phase !== 'downloading' && state.phase !== 'installing') {
      publish({ phase: 'checking' })
    }
    showDialog(getWindow())
  }
  if (busy || state.phase === 'installing' || (!automatic && cached)) return
  busy = true
  announceDownload = automatic
  let version: string | undefined
  try {
    const portable = isPortableUpdatable()
    const release = portable
      ? await checkPortableUpdate(candidate => autoUpdater.currentVersion.compare(candidate) < 0)
      : undefined
    const result = portable ? undefined : await autoUpdater.checkForUpdates()
    // A cached installer may have been launched during a scheduled release check.
    if (cached && state !== previous) return
    if (!portable && !result) {
      if (!cached) publish({ phase: 'error', stage: 'check' })
      return
    }
    version = release?.version ?? (result?.isUpdateAvailable ? result.updateInfo.version : undefined)
    if (!version) {
      publish({ phase: 'current' })
      return
    }
    if (cached && previous.version === version) return
    publish({ phase: 'downloading', version, progress: null })
    if (release) {
      const download = await downloadPortableUpdate(release, progress => {
        if (state.phase === 'downloading') publish({ ...state, progress })
      })
      if (portableDownload) discardPortableFiles(portableDownload.directory)
      portableDownload = download
    } else {
      await autoUpdater.downloadUpdate()
    }
    publish({ phase: 'ready', version })
    if (announceDownload) showDialog(getWindow())
  } catch (error) {
    log.warn('Software update failed:', error)
    if (version) publish({ phase: 'error', stage: 'download', version })
    else if (!cached) publish({ phase: 'error', stage: 'check' })
  } finally {
    busy = false
  }
}

export const checkUpdates = (win: BrowserWindow | null): void => {
  void runCheck(false, () => win)
}

ipcMain.on('mt::check-for-update', ({ sender }) => {
  void runCheck(false, () => BrowserWindow.fromWebContents(sender))
})

export const startAutomaticUpdateChecks = (getWindow: () => BrowserWindow | null): void => {
  if (timer || !isUpdatable()) return
  const check = (): void => { void runCheck(true, getWindow) }
  timer = setInterval(check, CHECK_INTERVAL_MS)
  app.once('will-quit', () => {
    clearInterval(timer)
    timer = undefined
  })
  if (isPortableUpdatable()) {
    app.once('quit', () => {
      pendingPortableInstall?.apply()
      if (portableDownload) discardPortableFiles(portableDownload.directory)
    })
  }
  check()
}
