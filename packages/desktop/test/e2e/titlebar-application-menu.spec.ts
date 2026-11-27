import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  expectNoRendererErrors,
  launchWithMarkdown,
  toggleReadingMode,
  waitForMenuReady
} from './helpers'

test.describe('Persistent title bar menus', () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system menu bar')

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('Alpha beta gamma\n', {
      preferences: { titleBarStyle: 'custom', language: 'zh-CN' },
      suppressErrorDialog: true
    })
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    await page.waitForSelector('.mu-container')
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('shows every category directly in the title bar', async() => {
    await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText([
      '文件',
      '编辑',
      '段落',
      '格式',
      '窗口',
      '主题',
      '视图',
      '帮助'
    ])
    await expect(page.getByRole('menuitem', { name: '文件', exact: true })).toBeVisible()
    await expect(page.locator('.frameless-titlebar-menu')).toHaveCount(0)
    const title = page.locator('.title-bar .title')
    await expect(title.locator('.title-brand, .filename')).toHaveText(['AutumnMark', 'note.md'])
    await expect(title.locator('.title-brand img')).toBeVisible()
    await expect(page.locator('.announcement-trigger')).toBeVisible()
    await expect(page.locator('.document-status .word-count')).toBeVisible()
  })

  test('opens and closes the existing native submenu', async() => {
    const file = page.getByRole('menuitem', { name: '文件', exact: true })
    await app.evaluate(({ Menu }) => {
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function(options) {
        Menu.prototype.popup = popup
        const state = globalThis as typeof globalThis & { filePopup?: typeof Menu.prototype }
        this.once('menu-will-show', () => { state.filePopup = this })
        popup.call(this, options)
      }
    })
    await file.focus()
    await file.press('ArrowDown')
    await expect.poll(() => app.evaluate(() => 'filePopup' in globalThis)).toBe(true)
    await expect(file).toHaveAttribute('aria-expanded', 'true')
    await app.evaluate(({ Menu }) => {
      const state = globalThis as typeof globalThis & { filePopup?: typeof Menu.prototype }
      state.filePopup?.closePopup()
      delete state.filePopup
    })
    await expect(file).toHaveAttribute('aria-expanded', 'false')
    await expectNoRendererErrors(app)
  })

  test('supports keyboard navigation across categories', async() => {
    const items = page.getByRole('menubar').getByRole('menuitem')
    await items.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(items.last()).toBeFocused()
  })

  test('keeps menus, drag space, statistics and controls separate at minimum width', async() => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(550, 500)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(560)
    const width = await page.evaluate(() => window.innerWidth)
    const selectors = [
      '.application-menubar',
      '.title-bar .title',
      '.statistics-toolbar',
      '.window-controls'
    ]
    const bounds = await page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const element = document.querySelector(selector)
          if (!element) throw new Error(`Missing ${selector}`)
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width }
        }),
      selectors
    )
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index].left).toBeGreaterThanOrEqual(bounds[index - 1].right - 0.1)
    }
    expect(bounds[1].width).toBeGreaterThanOrEqual(32)
    await expect(page.locator('.title-brand img')).toBeVisible()
    const filename = page.locator('.title-bar .filename')
    expect(await filename.evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(32)
    expect(bounds[3].right).toBeLessThanOrEqual(width + 0.1)
    await expect(page.locator('.frameless-titlebar-close')).toBeVisible()
    await expectNoRendererErrors(app)
  })

  test('updates category availability when reading mode changes', async() => {
    const paragraph = page.getByRole('menuitem', { name: '段落', exact: true })
    const format = page.getByRole('menuitem', { name: '格式', exact: true })
    await expect(paragraph).toBeEnabled()
    await toggleReadingMode(page)
    await expect(paragraph).toBeDisabled()
    await expect(format).toBeDisabled()
    await toggleReadingMode(page)
    await expect(paragraph).toBeEnabled()
    await expect(format).toBeEnabled()
  })

  test('updates category labels after changing the application language', async() => {
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { language: 'en' })
    })
    await expect(page.getByRole('menubar').getByRole('menuitem').first()).toHaveText('File')
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { language: 'zh-CN' })
    })
    await expect(page.getByRole('menubar').getByRole('menuitem').first()).toHaveText('文件')
    await expectNoRendererErrors(app)
  })

  test('keeps the Windows Mica backdrop while changing themes and window focus', async() => {
    test.skip(!await page.evaluate(() => window.marktext?.env?.micaTitleBar), 'Mica requires Windows 11 22H2')
    const editor = await app.browserWindow(page)
    const titleBar = page.locator('.title-bar-editor-bg')
    const startupColor = await editor.evaluate(win => win.getBackgroundColor())
    await editor.evaluate(win => win.focus())
    await expect(titleBar).toHaveClass(/mica-title-bar/)

    const settingsOpened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await settingsOpened
    await expect(settings.locator('.pref-container')).toBeVisible()
    await expect(titleBar).not.toHaveClass(/mica-title-bar/)
    for (const theme of ['dark', 'light']) {
      await settings.evaluate(theme => window.electron.ipcRenderer.invoke('mt::preferences::update', {
        theme, followSystemTheme: false
      }), theme)
      await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme)
      expect(await editor.evaluate(win => win.getBackgroundColor())).toBe(startupColor)
    }
    await editor.evaluate(win => win.focus())
    await expect(titleBar).toHaveClass(/mica-title-bar/)
  })
})
