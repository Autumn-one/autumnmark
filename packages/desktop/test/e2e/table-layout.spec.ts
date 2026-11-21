import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown, toggleReadingMode } from './helpers'

test('saves a resized column to Markdown and restores its width in reading mode', async() => {
  const { app, page, filePath } = await launchWithMarkdown('| Name | Notes |\n| --- | --- |\n| A | B |\n')
  try {
    const header = page.locator('.mu-table-inner tr').first().locator('td').first()
    await expect(header).toBeVisible()
    const box = await header.boundingBox()
    if (!box) throw new Error('Header is outside the viewport')
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 1, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 179, y, { steps: 6 })
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('<!-- table-layout: col-widths="1:180" -->')
    await toggleReadingMode(page)
    await expect.poll(async() => Math.round((await header.boundingBox())?.width ?? 0)).toBe(180)
  } finally {
    await app.close()
  }
})
