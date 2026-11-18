import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, dialog, ipcMain, Menu, type MessageBoxOptions } from 'electron'
import log from 'electron-log'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { isOsx } from '../../config'
import { t } from '../../i18n'
import { isUpdatable } from '../../utils/isUpdatable'

const UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000
const INSTALL_BUTTON_ID = 0
const LATER_BUTTON_ID = 1

type UpdateWindow = () => BrowserWindow | null

interface UpdateCheck {
  automatic: boolean
  getWindow: UpdateWindow
}

let activeCheck: UpdateCheck | undefined
let installAttempt: UpdateCheck | undefined
let dismissedVersion: string | undefined
let updateTimer: ReturnType<typeof setInterval> | undefined

autoUpdater.autoDownload = false
// Fork builds follow published stable releases, including builds installed from a dev version.
autoUpdater.allowPrerelease = false

const getLiveWindow = (check: UpdateCheck): BrowserWindow | null => {
  const win = check.getWindow()
  return win && !win.isDestroyed() ? win : null
}

autoUpdater.on('error', () => {
  // Installer launch can emit an error after quitAndInstall returns.
  if (!installAttempt) return
  getLiveWindow(installAttempt)?.webContents.send('mt::UPDATE_ERROR', 'install')
  installAttempt = undefined
})

const runUpdateCheck = async(check: UpdateCheck): Promise<void> => {
  if (activeCheck) {
    if (!check.automatic) {
      Object.assign(activeCheck, check)
    }
    return
  }
  activeCheck = check
  installAttempt = undefined
  let installing = false

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return
    if (!result.isUpdateAvailable) {
      if (!check.automatic) {
        getLiveWindow(check)?.webContents.send('mt::UPDATE_NOT_AVAILABLE')
      }
      return
    }

    const { version } = result.updateInfo
    if (check.automatic && version === dismissedVersion) return

    const win = getLiveWindow(check)
    const options: MessageBoxOptions = {
      type: 'info',
      title: t('updates.title'),
      message: t('updates.available', { version }),
      detail: t('updates.installDetail'),
      buttons: [t('updates.install'), t('updates.later')],
      defaultId: LATER_BUTTON_ID,
      cancelId: LATER_BUTTON_ID,
      noLink: true
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)

    if (response !== INSTALL_BUTTON_ID) {
      dismissedVersion = version
      return
    }

    installing = true
    await autoUpdater.downloadUpdate()
    getLiveWindow(check)?.webContents.send('mt::UPDATE_DOWNLOADED')
    installAttempt = check
    autoUpdater.quitAndInstall()
  } catch (error) {
    installAttempt = undefined
    log.warn('Software update failed:', error)
    if (!check.automatic || installing) {
      getLiveWindow(check)?.webContents.send('mt::UPDATE_ERROR', installing ? 'install' : 'check')
    }
  } finally {
    activeCheck = undefined
  }
}

export const checkUpdates = (browserWindow: BrowserWindow | null): void => {
  void runUpdateCheck({ automatic: false, getWindow: () => browserWindow })
}

export const startAutomaticUpdateChecks = (getWindow: UpdateWindow): void => {
  if (updateTimer || !isUpdatable()) return

  const check = (): void => {
    void runUpdateCheck({ automatic: true, getWindow })
  }
  updateTimer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  app.once('will-quit', () => {
    clearInterval(updateTimer)
    updateTimer = undefined
  })
  check()
}

ipcMain.on('mt::check-for-update', (event) => {
  checkUpdates(BrowserWindow.fromWebContents(event.sender))
})

export const userSetting = (): void => {
  ipcMain.emit('app-create-settings-window')
}

export const osxHide = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hide:')
  }
}

export const osxHideAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hideOtherApplications:')
  }
}

export const osxShowAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('unhideAllApplications:')
  }
}


export const loadMarktextCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.MT_HIDE, osxHide)
  commandManager.add(COMMANDS.MT_HIDE_OTHERS, osxHideAll)
}
