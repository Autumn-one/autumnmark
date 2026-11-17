import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updater, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    updater: {
      autoDownload: true,
      allowPrerelease: true,
      on: (event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
})
vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('electron', () => ({ BrowserWindow: {}, Menu: {}, ipcMain: { on: vi.fn() } }))
vi.mock('../../../src/main/config', () => ({ isOsx: false }))
vi.mock('../../../src/main/commands', () => ({ COMMANDS: {} }))
import { checkUpdates } from '../../../src/main/menu/actions/marktext'

describe('fork update checks', () => {
  beforeEach(() => {
    listeners.get('error')?.(new Error('reset'))
    updater.checkForUpdates.mockReset().mockResolvedValue(null)
  })

  it('uses stable releases even when the installed version is a development build', () => {
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.autoDownload).toBe(false)
  })

  it('allows retry after a network or missing-release error', () => {
    checkUpdates(null)
    checkUpdates(null)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    listeners.get('error')?.(new Error('No releases yet'))
    checkUpdates(null)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('handles a rejected check without leaving the next check locked', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Network offline'))
    checkUpdates(null)
    await Promise.resolve()
    checkUpdates(null)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})
