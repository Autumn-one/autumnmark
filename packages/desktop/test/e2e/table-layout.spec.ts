import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown, toggleReadingMode } from './helpers'

test('shrinking the outside edge of a full-width table keeps the internal divider stationary', async() => {
  const source = '<!-- table-layout: col-widths="1:100%,2:160" -->\n\n| Name | Notes |\n| --- | --- |\n| A | B |\n'
  const { app, page, filePath } = await launchWithMarkdown(source)
  try {
    const header = page.locator('.mu-table-inner tr').first().locator('td')
    await expect(header.last()).toBeVisible()
    const before = await header.last().boundingBox()
    if (!before) throw new Error('Table is outside the viewport')
    const x = before.x + before.width - 1
    const y = before.y + before.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 32, y, { steps: 6 })
    const during = await header.last().boundingBox()
    if (!during) throw new Error('Table disappeared while dragging')
    expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(during.width - before.width + 32)).toBeLessThanOrEqual(1)
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('2:128"')
    await toggleReadingMode(page)
    const after = await header.last().boundingBox()
    if (!after) throw new Error('Table disappeared in reading mode')
    expect(Math.abs(after.x - during.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.width - during.width)).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
  }
})

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
