import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { readFileSync } from 'node:fs'
import { clickMenuById, enterSourceMode, exitSourceMode, getMarkdownContent, launchWithMarkdown } from './helpers'

const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAAdSURBVDhPY5Cb8P8/JZgBXYBUPGrAqAGjBgwWAwAsZKwfgyie3AAAAABJRU5ErkJggg=='
const src = 'data:image/png;base64,' + png

test('embedded images survive save and mode changes and delete in one keystroke', async() => {
  test.setTimeout(60000)
  const markdown = `before ![dot](${src}) after`
  const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { imageInsertAction: 'embed' } })
  try {
    const atom = page.locator('.mu-editor .mu-embedded-image')
    await expect(atom).toHaveCount(1)
    await expect(atom.locator('img')).toHaveJSProperty('naturalWidth', 16)
    await expect(page.locator('.mu-editor')).not.toContainText(png)
    await atom.click()
    await expect(page.locator('.embedded-image-preview')).toHaveAttribute('src', src)
    await page.keyboard.press('Escape')
    const placeAfterImage = () => atom.evaluate(node => {
      const range = document.createRange()
      range.setStartAfter(node)
      range.collapse(true)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    })
    await placeAfterImage()
    await page.keyboard.press('Backspace')
    await expect(atom).toHaveCount(0)
    await expect(page.locator('.mu-editor')).toContainText('before  after', { useInnerText: false })
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom).toHaveCount(1)
    await placeAfterImage()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Delete')
    await expect(atom).toHaveCount(0)
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom).toHaveCount(1)

    await enterSourceMode(page, app)
    const chip = page.locator('.CodeMirror .embedded-image-chip')
    await expect(chip).toHaveCount(1)
    await expect(page.locator('.CodeMirror-code')).not.toContainText(png)
    expect((await getMarkdownContent(page, app)).trim()).toBe(markdown)
    await page.locator('.CodeMirror').evaluate(node => {
      const cm = (node as HTMLElement & { CodeMirror?: CodeMirror.Editor }).CodeMirror
      if (!cm) throw new Error('Source editor is unavailable')
      cm.focus()
      cm.setCursor({ line: 0, ch: 'before '.length })
    })
    await page.keyboard.press('Delete')
    expect((await getMarkdownContent(page, app)).trim()).toBe('before  after')
    await clickMenuById(app, 'undoMenuItem')
    await expect(chip).toHaveCount(1)
    await chip.click()
    await expect(page.locator('.embedded-image-preview')).toBeVisible()
    await page.locator('.el-dialog:visible .el-button--danger').click()
    expect((await getMarkdownContent(page, app)).trim()).toBe('before  after')
    await page.locator('.CodeMirror').evaluate((node, data) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'blue.png', { type: 'image/png' }))
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
    }, png)
    await expect(chip).toHaveCount(1)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(`![blue.png](${src})`)
    await exitSourceMode(page, app)
    await expect(atom.locator('img')).toHaveAttribute('src', src)
  } finally {
    await app.close()
  }
})

test('paste, drop and replace embedded images without changing the original bytes', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Paragraph', { preferences: { imageInsertAction: 'embed' } })
  try {
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('End')
    const transferImage = async(selector: string, action: 'drop' | 'paste') => {
      await page.locator(selector).first().evaluate((node, { data, action }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'dot.png', { type: 'image/png' }))
        const { x, y } = node.getBoundingClientRect()
        const event = action === 'drop'
          ? new DragEvent('drop', { dataTransfer: transfer, clientX: x + 2, clientY: y + 2, cancelable: true, bubbles: true })
          : new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true, bubbles: true })
        node.dispatchEvent(event)
      }, { data: png, action })
    }
    const atom = page.locator('.mu-embedded-image')
    await transferImage('.mu-paragraph-content', 'paste')
    await expect(atom).toHaveCount(1)
    await transferImage('.mu-paragraph-content', 'drop')
    await expect(atom).toHaveCount(2)
    await enterSourceMode(page, app)
    await expect(page.locator('.embedded-image-chip')).toHaveCount(2)
    await transferImage('.CodeMirror-code', 'drop')
    await expect(page.locator('.embedded-image-chip')).toHaveCount(3)
    const replacement = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2D canvas is unavailable')
      const pixels = ctx.createImageData(canvas.width, canvas.height)
      for (let pos = 0; pos < pixels.data.length; pos += 16384)
        crypto.getRandomValues(pixels.data.subarray(pos, pos + 16384))
      ctx.putImageData(pixels, 0, 0)
      return canvas.toDataURL()
    })
    expect(replacement.length).toBeGreaterThan(1_000_000)
    await page.locator('.embedded-image-chip').first().click()
    await page.locator('.el-dialog:visible input[type=file]').setInputFiles({
      name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1], 'base64')
    })
    await expect(page.locator('.embedded-image-preview')).toHaveCount(0)
    await expect(page.locator('.CodeMirror-code')).not.toContainText(replacement.slice(30, 90))
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8').includes(replacement)).toBe(true)
    await exitSourceMode(page, app)
    await expect(atom).toHaveCount(3)
    await expect(atom.first().locator('img')).toHaveJSProperty('naturalWidth', 640)
    await expect(page.locator('.mu-editor')).not.toContainText(replacement.slice(30, 90))
  } finally {
    await app.close()
  }
})

test('existing embedded images stay compact in references, literal code and HTML', async() => {
  const markdown = [
    '**Before** ![reference][pic]',
    `[pic]: ${src}`,
    `\`\`\`markdown\n![sample](${src})\n\`\`\``,
    `After <img width="12" alt="square" src="${src}"> end`
  ].join('\n\n')
  const { page, app } = await launchWithMarkdown(markdown, { preferences: { imageInsertAction: 'path' } })
  try {
    await expect(page.locator('.mu-embedded-image')).toHaveCount(3)
    await expect(page.locator('.mu-editor')).not.toContainText(png)
    await expect(page.locator('.mu-embedded-image img[alt=square]')).toHaveAttribute('width', '12')
    await enterSourceMode(page, app)
    await expect(page.locator('.embedded-image-chip')).toHaveCount(3)
    await expect(page.locator('.CodeMirror-code')).not.toContainText(png)
    expect((await getMarkdownContent(page, app)).trim()).toBe(markdown)
  } finally {
    await app.close()
  }
})
