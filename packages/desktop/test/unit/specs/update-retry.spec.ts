import { app, type BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updater, listeners, showMessageBox, isUpdatable } = vi.hoisted(() => {
  const listeners = new Map<string, () => void>()
  return {
    listeners,
    showMessageBox: vi.fn(),
    isUpdatable: vi.fn(),
    updater: {
      autoDownload: true,
      allowPrerelease: true,
      on: (event: string, listener: () => void) => listeners.set(event, listener),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
})
vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  return {
    app: new EventEmitter(),
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showMessageBox },
    Menu: {},
    ipcMain: { on: vi.fn() }
  }
})
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))
vi.mock('../../../src/main/config', () => ({ isOsx: false }))
vi.mock('../../../src/main/commands', () => ({ COMMANDS: {} }))
vi.mock('../../../src/main/utils/isUpdatable', () => ({ isUpdatable }))
import { setLanguage } from '../../../src/main/i18n'
import { checkUpdates, startAutomaticUpdateChecks } from '../../../src/main/menu/actions/marktext'

const TWENTY_MINUTES = 20 * 60 * 1000
const send = vi.fn()
const win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
const availableUpdate = (version: string) => ({ isUpdateAvailable: true, updateInfo: { version } })

describe('fork update checks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setLanguage('en')
    send.mockClear()
    isUpdatable.mockReset().mockReturnValue(true)
    showMessageBox.mockReset().mockResolvedValue({ response: 1 })
    updater.checkForUpdates.mockReset().mockResolvedValue({ isUpdateAvailable: false })
    updater.downloadUpdate.mockReset().mockResolvedValue([])
    updater.quitAndInstall.mockClear()
  })

  afterEach(async() => {
    app.emit('will-quit', {} as Electron.Event)
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
  })

  it('uses stable releases even when the installed version is a development build', () => {
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.autoDownload).toBe(false)
  })

  it('handles a rejected check without leaving the next check locked', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Network offline'))
    checkUpdates(win)
    checkUpdates(win)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith('mt::UPDATE_ERROR', 'check')
    checkUpdates(win)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('checks at startup and every twenty minutes until quit', async() => {
    startAutomaticUpdateChecks(() => win)
    startAutomaticUpdateChecks(() => win)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES - 1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    expect(showMessageBox).not.toHaveBeenCalled()

    app.emit('will-quit', {} as Electron.Event)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('skips background checks for packages without update support', async() => {
    isUpdatable.mockReturnValue(false)
    startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports the result when a manual check joins a running background check', async() => {
    startAutomaticUpdateChecks(() => null)
    checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('mt::UPDATE_NOT_AVAILABLE')
  })

  it('retries silent background failures at the next interval', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Network offline'))
    startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('uses the current language and only repeats dismissed versions on manual checks', async() => {
    setLanguage('zh-CN')
    updater.checkForUpdates.mockResolvedValue(availableUpdate('1.1.0'))
    startAutomaticUpdateChecks(() => null)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: '软件更新',
      message: '发现新版本 1.1.0。',
      buttons: ['下载并安装', '稍后'],
      defaultId: 1,
      cancelId: 1
    }))
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    setLanguage('fr')
    checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    expect(showMessageBox).toHaveBeenLastCalledWith(win, expect.objectContaining({
      message: 'La version 1.1.0 est disponible.',
      buttons: ['Télécharger et installer', 'Plus tard']
    }))

    updater.checkForUpdates.mockResolvedValue(availableUpdate('1.2.0'))
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(showMessageBox).toHaveBeenCalledTimes(3)
    expect(showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'La version 1.2.0 est disponible.'
    }))
  })

  it('keeps background checks from overlapping an accepted download', async() => {
    showMessageBox.mockResolvedValue({ response: 0 })
    updater.checkForUpdates.mockResolvedValue(availableUpdate('1.3.0'))
    updater.downloadUpdate.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve([]), TWENTY_MINUTES + 1)
    }))
    startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledWith('mt::UPDATE_DOWNLOADED')
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports asynchronous installer launch failures after an automatic prompt', async() => {
    showMessageBox.mockResolvedValue({ response: 0 })
    updater.checkForUpdates.mockResolvedValue(availableUpdate('1.4.0'))
    startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)

    listeners.get('error')?.()
    expect(send).toHaveBeenCalledWith('mt::UPDATE_ERROR', 'install')
  })
})
