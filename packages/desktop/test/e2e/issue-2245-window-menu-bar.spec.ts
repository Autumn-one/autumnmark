import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchWithMarkdown, waitForMenuReady } from './helpers'

const windowGeometry = (app: ElectronApplication, windowId: number) =>
  app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.fromId(id)
    if (!win) throw new Error('Missing window')
    return {
      chromeHeight: win.getSize()[1] - win.getContentSize()[1],
      menuBarVisible: win.isMenuBarVisible(),
      minimumSize: win.getMinimumSize()
    }
  }, windowId)

const focusWindow = async(app: ElectronApplication, windowId: number): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.fromId(id)?.focus()
  }, windowId)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getFocusedWindow()?.id)).toBe(windowId)
}

const hasGlobalMenu = (xid: number): boolean => {
  try {
    const reply = execFileSync('gdbus', [
      'call', '--session', '--timeout', '2',
      '--dest', 'com.canonical.AppMenu.Registrar',
      '--object-path', '/com/canonical/AppMenu/Registrar',
      '--method', 'com.canonical.AppMenu.Registrar.GetMenuForWindow', String(xid)
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    return /'\/[^']+'/.test(reply)
  } catch {
    return false
  }
}

test('replays application menus without changing editor or Preferences geometry (#2245)', async() => {
  test.skip(process.platform === 'darwin', 'macOS draws one menu bar for the whole application')

  const { app, page } = await launchWithMarkdown('# Menu bars\n', {
    preferences: { titleBarStyle: 'native', language: 'en' }
  })
  try {
    await waitForMenuReady(app)
    await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveCount(8)
    const editorWindow = await app.browserWindow(page)
    const editorId = await editorWindow.evaluate(win => win.id)
    const editorBaseline = await windowGeometry(app, editorId)
    expect(editorBaseline.menuBarVisible).toBe(false)

    // The positive control can appear in Views or in the X11 desktop panel.
    const showsInWindow = await app.evaluate(({ BrowserWindow, Menu }, id) => {
      const win = BrowserWindow.fromId(id)
      const menu = Menu.getApplicationMenu()
      if (!win || !menu) throw new Error('Missing editor or menu')
      win.setMenu(menu)
      win.setMenuBarVisibility(true)
      return win.isMenuBarVisible()
    }, editorId)
    let globalMenuId: number | undefined
    if (showsInWindow || process.platform !== 'linux') {
      expect(showsInWindow).toBe(true)
      await expect.poll(async() => (await windowGeometry(app, editorId)).chromeHeight)
        .toBeGreaterThan(editorBaseline.chromeHeight)
    } else {
      const xid: number = await editorWindow.evaluate(win => win.getNativeWindowHandle().readUInt32LE())
      globalMenuId = xid
      await expect.poll(() => hasGlobalMenu(xid)).toBe(true)
    }

    const rebuildMenu = async(language: string): Promise<void> => {
      await page.evaluate(language => window.electron.ipcRenderer.invoke('mt::preferences::update', {
        language
      }), language)
      // A fresh active menu forces the global attach-and-detach path.
      await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0].label.replaceAll('&', '')))
        .toContain(language === 'en' ? 'File' : '文件')
    }

    await rebuildMenu('zh-CN')
    await expect.poll(() => windowGeometry(app, editorId)).toEqual(editorBaseline)
    if (globalMenuId !== undefined) {
      const xid = globalMenuId
      await expect.poll(() => hasGlobalMenu(xid)).toBe(false)
    }

    const settingsOpened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await settingsOpened
    await settings.locator('.pref-container').waitFor()
    const settingsWindow = await app.browserWindow(settings)
    const settingsId = await settingsWindow.evaluate(win => win.id)
    const settingsBaseline = await windowGeometry(app, settingsId)
    expect(settingsBaseline.menuBarVisible).toBe(false)

    for (const language of ['en', 'zh-CN', 'en']) {
      await focusWindow(app, settingsId)
      await focusWindow(app, editorId)
      await rebuildMenu(language)
      await expect.poll(() => windowGeometry(app, editorId)).toEqual(editorBaseline)
      await expect.poll(() => windowGeometry(app, settingsId)).toEqual(settingsBaseline)
    }

    await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeEnabled()
    if (globalMenuId !== undefined) {
      const xid = await settingsWindow.evaluate(win => win.getNativeWindowHandle().readUInt32LE())
      await expect.poll(() => hasGlobalMenu(xid)).toBe(false)
    }
  } finally {
    await app.close()
  }
})
