import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithDoc, launchWithMarkdown } from './helpers'

test('saves a resized block and reopens it with compact mode disabled', async() => {
  const body = Array.from({ length: 24 }, (_, i) => `row ${i + 1}`).join('\n')
  const markdown = `~~~js title="example.js"\n${body}\n~~~\n\n~~~\n${body}\n~~~\n`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { compactMode: true, compactCodeMaxLines: 6 }
  })
  try {
    const block = page.locator('.mu-code-block').first()
    await expect(block.locator('.mu-compact-toggle')).toBeVisible()
    const handle = block.locator('.mu-code-resize')
    await handle.scrollIntoViewIfNeeded()
    const { x, y } = await handle.evaluate(el => {
      const box = el.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    const lineHeight = await block.locator('.mu-code').evaluate(el => parseFloat(getComputedStyle(el).lineHeight))
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 2 * lineHeight)
    await page.mouse.up()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'))
      .toBe(markdown.replace('title="example.js"', 'title="example.js" max-lines=8'))
  } finally {
    await app.close()
  }

  const reopened = await launchWithDoc(filePath, { preferences: { compactMode: false } })
  try {
    const viewports = reopened.page.locator('.mu-code-block .mu-code')
    await expect.poll(() => viewports.evaluateAll(elements =>
      elements.map(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)))
    )).toEqual([8, 24])
  } finally {
    await reopened.app.close()
  }
})
