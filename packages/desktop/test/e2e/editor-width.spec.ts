import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('the visual editor and theme preview fill their available width and H1s can wrap', async() => {
  const title = 'A long first-level heading that needs multiple lines. '.repeat(12).trim()
  const { app, page } = await launchWithMarkdown(`Body\n\n# ${title}\n\n${title}\n======\n`, {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false, editorLineWidth: '240px' },
    windowLayout: { showSideBar: false }
  })
  try {
    const window = await app.browserWindow(page)
    await window.evaluate(win => win.setContentSize(1200, 780))
    const container = page.locator('.editor-component .mu-container')
    await expect(container).toHaveCSS('max-width', 'none')
    await expect.poll(() => container.evaluate(el => el.clientWidth)).toBeGreaterThan(800)

    await container.locator('.mu-paragraph').click()
    for (const selector of ['h1.mu-atx-heading', 'h1.mu-setext-heading']) {
      const heading = container.locator(`${selector} > .mu-content`)
      await expect(heading).toHaveCSS('text-overflow', 'clip')
      await expect.poll(() => heading.evaluate(el =>
        el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)
      )).toBeGreaterThan(1.5)
    }

    const openingSettings = app.waitForEvent('window')
    await clickMenuById(app, 'openThemeSettings')
    const settings = await openingSettings
    await settings.locator('.theme-card').first().getByRole('button', { name: /^Preview · / }).click()
    const preview = settings.frameLocator('.catalog-theme-preview iframe')
    await expect(preview.locator('body.catalog-preview .mu-container')).toHaveCSS('max-width', 'none')
  } finally {
    await app.close()
  }
})
