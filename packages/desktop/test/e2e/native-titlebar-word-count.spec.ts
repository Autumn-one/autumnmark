import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

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
  })
})
