import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('default editor width fills available width and explicit editorLineWidth caps it', async() => {
  const title = 'A long first-level heading that needs multiple lines. '.repeat(12).trim()
  const { app, page } = await launchWithMarkdown(`Body\n\n# ${title}\n\n${title}\n======\n`, {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    windowLayout: { showSideBar: false }
  })
  try {
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate(win => win.setContentSize(1200, 780))
    const container = page.locator('.editor-component .mu-container')
    await expect.poll(() => container.evaluate(el => el.clientWidth)).toBeGreaterThan(800)

    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineWidth: '' }))
    await expect.poll(() => container.evaluate(el => el.clientWidth)).toBeGreaterThan(800)

    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineWidth: '240px' }))
    await expect(container).toHaveCSS('max-width', '340px')
    await expect.poll(() => container.evaluate(el => el.clientWidth)).toBeLessThanOrEqual(340)

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
    await expect(preview.locator('body.catalog-preview .mu-container')).toHaveCSS('max-width', '680px')
  } finally {
    await app.close()
  }
})
