import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, exitSourceMode, launchWithMarkdown, sendIpcToRenderer } from './helpers'

test.describe('Native title bar keeps the word counter', () => {
  test.skip(process.platform === 'darwin', 'macOS windows are always frameless')

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('Alpha beta gamma\n', {
      preferences: { titleBarStyle: 'native', language: 'en' }
    })
    app = launched.app
    page = launched.page
    await page.waitForSelector('.mu-container', { timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('shows the word counter without repeating the filename', async() => {
    await expect(page.locator('.document-status .word-count')).toHaveText('Words 3')
    await expect(page.locator('.title-bar .title')).toHaveCount(0)
    const bar = page.locator('.title-bar.native-menubar')
    await expect(bar).toHaveCSS('-webkit-app-region', 'no-drag')
    await expect(bar.getByRole('menubar')).toBeVisible()
    await expect(bar.locator('.announcement-trigger')).toBeVisible()
  })

  test('uses Alt and Escape to return to the Markdown selection after closing a submenu', async() => {
    const nativeWindow = await app.browserWindow(page)
    await nativeWindow.evaluate(win => win.focus())
    await expect.poll(() => nativeWindow.evaluate(win => win.isFocused())).toBe(true)
    const editor = page.locator('.editor-component')
    const items = page.getByRole('menubar').getByRole('menuitem')
    await editor.focus()
    await editor.locator('.mu-paragraph-content').first().evaluate(element => {
      document.getSelection()?.setBaseAndExtent(element, element.childNodes.length, element, 0)
    })
    const selectionText = () => page.evaluate(() => document.getSelection()?.toString())
    const originalSelection = await selectionText()
    expect(originalSelection).toContain('Alpha beta gamma')

    await page.keyboard.press('Control+Alt')
    await expect(editor).toBeFocused()
    await page.keyboard.down('Alt')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.keyboard.up('Alt')
    await expect(editor).toBeFocused()
    await page.keyboard.press('Alt')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const edit = items.nth(1)
    await expect(edit).toBeFocused()

    await app.evaluate(({ Menu }) => {
      const submenu = Menu.getApplicationMenu()?.items[1].submenu
      if (!submenu) throw new Error('Missing Edit menu')
      // The native popup handles its own Escape; use the same close callback in Playwright.
      submenu.once('menu-will-show', () => setTimeout(() => submenu.closePopup(), 600))
    })
    await page.keyboard.press('ArrowDown')
    await expect(edit).toHaveAttribute('aria-expanded', 'true')
    await expect(edit).toHaveAttribute('aria-expanded', 'false')
    await expect(edit).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(editor).toBeFocused()
    await expect.poll(selectionText).toBe(originalSelection)
    expect(await page.evaluate(() => document.getSelection()?.direction)).toBe('backward')
  })

  test('returns focus to CodeMirror after toggling the menu with Alt', async() => {
    await enterSourceMode(page, app)
    try {
      const input = page.locator('.CodeMirror textarea')
      await input.focus()
      await page.keyboard.press('Alt')
      await expect(page.getByRole('menubar').getByRole('menuitem').first()).toBeFocused()
      await page.keyboard.press('Alt')
      await expect(input).toBeFocused()
    } finally {
      await exitSourceMode(page, app)
    }
  })

  test('refreshes native theme and the window background when the active local theme changes', async() => {
    const nativeWindow = await app.browserWindow(page)
    const theme = {
      version: 1 as const,
      id: 'local:light:11111111-1111-4111-8111-111111111111',
      name: 'Custom paper',
      base: 'light',
      values: {},
      css: ':root { --editorBgColor: #171717 }'
    }
    const initial = await page.evaluate(theme => window.electron.ipcRenderer.invoke('mt::preferences::update', {
      theme: theme.id, localThemes: [theme], followSystemTheme: false
    }), theme)
    expect(initial.status).toBe('persisted')
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
    await expect.poll(() => nativeWindow.evaluate(win => win.getBackgroundColor().toLowerCase())).toBe('#171717')

    theme.css = ':root { --editorBgColor: #808080 }'
    const edited = await page.evaluate(theme => window.electron.ipcRenderer.invoke('mt::preferences::update', {
      localThemes: [theme]
    }), theme)
    expect(edited.status).toBe('persisted')
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
    await expect.poll(() => nativeWindow.evaluate(win => win.getBackgroundColor().toLowerCase())).toBe('#808080')
  })

  test('shows the update percentage beside the bell when there is room', async() => {
    const nativeWindow = await app.browserWindow(page)
    const bar = page.locator('.native-menubar')
    const label = bar.locator('.update-trigger > span')
    await nativeWindow.evaluate(win => win.setSize(1150, 700))
    await sendIpcToRenderer(app, 'mt::update-state', {
      phase: 'downloading', version: '99.0.0', progress: { transferred: 42, total: 100, bytesPerSecond: 10 }
    })
    try {
      await expect(label).toBeVisible()
      await expect(label).toHaveText('42%')
      await expect(bar.locator('.announcement-trigger')).toBeVisible()

      await nativeWindow.evaluate(win => win.setSize(800, 700))
      await expect(label).toBeHidden()
      await expect(bar.locator('.update-trigger')).toBeVisible()
    } finally {
      await sendIpcToRenderer(app, 'mt::update-state', { phase: 'idle' })
    }
  })
})
