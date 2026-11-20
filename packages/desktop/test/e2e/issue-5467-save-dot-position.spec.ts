import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady } from './helpers'

const FILENAME = 'the-document-name.md'
const roots: string[] = []

test.afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
})

const openIn = async(
  folders: string[],
  width = 1280,
  filename = FILENAME
): Promise<{ app: ElectronApplication; page: Page }> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2etest-5467-'))
  roots.push(root)
  const dir = path.join(root, ...folders)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, 'Alpha\n', 'utf8')

  const { app, page } = await launchElectron([filePath], {
    preferences: { autoSave: false, language: 'en', titleBarStyle: 'custom' }
  })
  await waitForEditor(page)
  await waitForMenuReady(app)
  await page.setViewportSize({ width, height: 600 })
  await expect(page.locator('.title-bar .filename').first()).toHaveText(filename)
  return { app, page }
}

const markDirty = async(page: Page): Promise<void> => {
  await page
    .locator('.mu-paragraph-content')
    .filter({ hasText: 'Alpha' })
    .first()
    .click({ timeout: 5000 })
  await page.keyboard.insertText('x')
  await expect(page.locator('.title-bar .title .save-dot')).toHaveClass(/show/)
}

const boxOf = async(page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  return box
}

for (const [name, filename] of [['short', FILENAME], ['long', 'weekly-field-notes-'.repeat(7) + 'document.md']]) {
  test(`keeps the unsaved dot visible beside a ${name} filename`, async() => {
    const { app, page } = await openIn(['2024', '09', '18'], 940, filename)
    try {
      const title = page.locator('.title-bar .title')
      const dot = title.locator('.save-dot')
      await expect(title).toHaveText(filename + ' - AutumnMark')
      await expect(dot).toBeHidden()
      await markDirty(page)
      await expect(dot).toBeVisible()
      const dotBox = await boxOf(page, '.title-bar .title .save-dot')
      const fileBox = await boxOf(page, '.title-bar .title .filename')
      expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(fileBox.x + 0.5)
      if (name === 'long') {
        const file = title.locator('.filename')
        await expect(file).toHaveCSS('text-overflow', 'ellipsis')
        expect(await file.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
      }
    } finally {
      await app.close()
    }
  })
}
