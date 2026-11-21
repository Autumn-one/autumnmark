import { expect, test } from '@playwright/test'
import { clickMenuById, launchElectron, waitForMenuReady } from './helpers'

for (const debug of [false, true]) {
  test(`the View menu opens developer tools in ${debug ? 'debug' : 'normal'} mode`, async() => {
    // Unpackaged Electron reserves the --debug flag for Node (#5409).
    const { app, page } = await launchElectron([], { env: { MARKTEXT_DEBUG: debug ? '1' : '' } })
    try {
      await waitForMenuReady(app)
      const state = await app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()?.items.find(item =>
          item.submenu?.getMenuItemById('sourceCodeModeMenuItem')
        )?.submenu
        return {
          debug: !!global.MARKTEXT_DEBUG,
          toolsAvailable: view?.getMenuItemById('developerToolsMenuItem')?.visible,
          reloadAvailable: !!view?.getMenuItemById('reloadWindowMenuItem')
        }
      })
      expect(state).toEqual({ debug, toolsAvailable: true, reloadAvailable: debug })

      const editor = await app.browserWindow(page)
      const toolsOpen = () => editor.evaluate(win => win.webContents.isDevToolsOpened())
      await clickMenuById(app, 'developerToolsMenuItem')
      await expect.poll(toolsOpen).toBe(true)
      await clickMenuById(app, 'developerToolsMenuItem')
      await expect.poll(toolsOpen).toBe(false)
      await editor.evaluate(win => {
        win.focus()
        win.webContents.focus()
        const modifiers: Electron.KeyboardInputEvent['modifiers'] =
          process.platform === 'darwin' ? ['meta', 'alt'] : ['control', 'alt']
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'I', modifiers })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'I', modifiers })
      })
      await expect.poll(toolsOpen).toBe(true)
    } finally {
      await app.close()
    }
  })
}
