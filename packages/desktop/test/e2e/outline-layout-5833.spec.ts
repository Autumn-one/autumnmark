import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, showOutline } from './helpers'

let app: ElectronApplication
let page: Page
const sidebarWidth = (): Promise<number> => page.locator('.side-bar')
  .evaluate(el => Math.round(el.getBoundingClientRect().width))

test.beforeEach(async() => {
  ;({ app, page } = await launchWithMarkdown('# Document\n\n## Section\n\nBody text.\n', {
    preferences: { language: 'en', editorLineWidth: '100%' }
  }))
  const win = await app.browserWindow(page)
  await win.evaluate(window => window.setContentSize(1280, 800))
  await showOutline(app, page)
})
test.afterEach(async() => { await app?.close() })

test('files and outline share the same sidebar width with a wide editor', async() => {
  const editor = page.locator('.document-body')
  const before = await editor.boundingBox()
  expect(before?.width).toBeGreaterThan(500)
  const sidebar = await page.locator('.side-bar').boundingBox()
  expect(sidebar && before && sidebar.x + sidebar.width).toBe(before?.x)

  await page.getByRole('tab', { name: 'Files' }).click()
  await expect(page.locator('#sidebar-panel-files')).toBeVisible()
  expect(await editor.boundingBox()).toEqual(before)
  await page.getByRole('tab', { name: 'Outline' }).click()
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
  expect(await editor.boundingBox()).toEqual(before)
})

test('sidebar resizing is keyboard accessible and preserves the preferred width', async() => {
  const divider = page.getByRole('separator', { name: 'Resize sidebar' })
  await divider.press('Home')
  await expect.poll(sidebarWidth).toBe(220)
  await divider.press('ArrowRight')
  await expect.poll(sidebarWidth).toBe(230)
  await divider.press('End')
  await expect.poll(sidebarWidth).toBe(960)

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await expect.poll(() => {
    const state = JSON.parse(readFileSync(join(userData, 'state', 'application-state.json'), 'utf8'))
    return state.session.windows[0].layout.sidebar.preferredWidthPx
  }).toBe(960)

  const win = await app.browserWindow(page)
  await win.evaluate(window => window.setContentSize(850, 800))
  await expect.poll(sidebarWidth).toBe(530)
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
  await win.evaluate(window => window.setContentSize(1280, 800))
  await expect.poll(sidebarWidth).toBe(960)
})
