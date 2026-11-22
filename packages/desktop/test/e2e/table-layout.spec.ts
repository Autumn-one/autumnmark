import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown, toggleReadingMode } from './helpers'

test('resizes the full table height, then moves a divider without moving the bottom edge', async() => {
  const source = '<!-- table-layout: row-min-heights="1:64,2:96" -->\n\n| Name | Notes |\n| --- | --- |\n| A | B |\n'
  const { app, page, filePath } = await launchWithMarkdown(source)
  try {
    const rows = page.locator('.mu-table-inner tr')
    const heights = () => rows.evaluateAll(items => items.map(row => row.getBoundingClientRect().height))
    await expect(rows).toHaveCount(2)
    const bottom = await rows.last().boundingBox()
    if (!bottom) throw new Error('Table is outside the viewport')
    const x = bottom.x + 20
    const y = bottom.y + bottom.height - 1
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 40, { steps: 4 })
    expect(await heights()).toEqual([80, 120])
    await page.mouse.up()
    const header = await rows.first().boundingBox()
    if (!header) throw new Error('Missing header after resize')
    const divider = header.y + header.height - 1
    await page.mouse.move(x, divider)
    await page.mouse.down()
    await page.mouse.move(x, divider - 16, { steps: 4 })
    expect(await heights()).toEqual([64, 136])
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('row-min-heights="1:64,2:136"')
    await toggleReadingMode(page)
    await expect.poll(heights).toEqual([64, 136])
  } finally {
    await app.close()
  }
})

test('shrinking the outside edge scales both columns and saves their widths', async() => {
  const source = '<!-- table-layout: col-widths="1:100%,2:160" -->\n\n| Name | Notes |\n| --- | --- |\n| A | B |\n'
  const { app, page, filePath } = await launchWithMarkdown(source)
  try {
    const header = page.locator('.mu-table-inner tr').first().locator('td')
    await expect(header.last()).toBeVisible()
    const before = await header.last().boundingBox()
    const first = await header.first().boundingBox()
    if (!before || !first) throw new Error('Table is outside the viewport')
    const x = before.x + before.width - 1
    const y = before.y + before.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 32, y, { steps: 6 })
    const during = await header.last().boundingBox()
    if (!during) throw new Error('Table disappeared while dragging')
    const scale = 1 - 32 / (first.width + before.width)
    expect(Math.abs(during.x - first.x - first.width * scale)).toBeLessThanOrEqual(1)
    expect(Math.abs(during.x + during.width - (x + 1 - 32))).toBeLessThanOrEqual(1)
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(`2:${Math.round(during.width)}"`)
    await toggleReadingMode(page)
    const after = await header.last().boundingBox()
    if (!after) throw new Error('Table disappeared in reading mode')
    expect(Math.abs(after.x - during.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.width - during.width)).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
  }
})

test('moving the internal divider preserves total width in editing and reading mode', async() => {
  const source = '<!-- table-layout: col-widths="1:140,2:160" -->\n\n| Name | Notes |\n| --- | --- |\n| A | B |\n'
  const { app, page, filePath } = await launchWithMarkdown(source)
  try {
    const header = page.locator('.mu-table-inner tr').first().locator('td').first()
    await expect(header).toBeVisible()
    const box = await header.boundingBox()
    if (!box) throw new Error('Header is outside the viewport')
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 1, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 179, y, { steps: 6 })
    const grid = page.locator('.mu-table-inner')
    await expect(grid).toHaveCSS('width', '300px')
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('<!-- table-layout: col-widths="1:180,2:120" -->')
    await toggleReadingMode(page)
    await expect.poll(async() => Math.round((await header.boundingBox())?.width ?? 0)).toBe(180)
    await expect(grid).toHaveCSS('width', '300px')
  } finally {
    await app.close()
  }
})
