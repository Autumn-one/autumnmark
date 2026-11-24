import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { clickMenuById, launchWithMarkdown, sendIpcToRenderer } from './helpers'

test('drawings open immediately as tabs and persist their Markdown references', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# 发布清单\n\n- 检查构建\n', { preferences: { language: 'en' } })
  const drawingPath = join(dirname(filePath), '发布流程.excalidraw')
  const pdfPath = join(dirname(filePath), 'drawing-export.pdf')
  try {
    await app.evaluate(({ dialog }, { drawingPath, filePath }) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: drawingPath })
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
    }, { drawingPath, filePath })
    await clickMenuById(app, 'newDrawingMenuItem')

    const canvas = page.locator('.drawing-workspace:visible')
    await expect(page.locator('.editor-tabs li.active')).toHaveText('Untitled Drawing.excalidraw')
    await expect(page.locator('.editor-tabs')).toBeVisible()
    const tabs = page.locator('.editor-tabs')
    await expect(tabs.getByRole('button', { name: 'New Tab', exact: true })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'New Excalidraw Drawing', exact: true })).toHaveCount(0)
    await expect(page.locator('.editor-tabs li')).toHaveCount(2)
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    await canvas.getByRole('button', { name: 'Add Markdown Document' }).click()
    await canvas.getByLabel(basename(filePath)).selectOption('发布清单')
    await canvas.getByRole('button', { name: 'Add Card', exact: true }).click()
    await canvas.getByRole('button', { name: 'Save and Append to Note' }).click()
    await expect(canvas).toBeHidden()

    const savedDrawing = await readFile(drawingPath, 'utf8')
    const content = JSON.parse(savedDrawing)
    expect(content.type).toBe('excalidraw')
    expect(content.elements).toHaveLength(1)
    const [card] = content.elements
    expect(card.customData.autumnmarkDocument).toEqual({ path: basename(filePath), heading: '发布清单' })
    expect(content.files[card.fileId].dataURL).toMatch(/^data:image\/png;base64,/)
    await expect(page.locator('.editor-tabs li[aria-label="发布流程.excalidraw"]')).toHaveCount(1)

    const preview = page.getByRole('img', { name: '发布流程' })
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const previousPreview = await preview.getAttribute('src')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFile(filePath, 'utf8')).toContain('.excalidraw)')
    await expect.poll(() => preview.getAttribute('src')).not.toBe(previousPreview)

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, pdfPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(async() => {
      const pdf = await readFile(pdfPath).catch(() => Buffer.alloc(0))
      return /\/Subtype\s*\/Image\b/.test(pdf.toString('latin1'))
    }).toBe(true)

    await preview.dblclick()
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    await expect(page.locator('.editor-tabs li.active')).toHaveText('发布流程.excalidraw')
    await expect(page.locator('.editor-tabs li')).toHaveCount(2)
    await canvas.locator('canvas.interactive').dblclick()
    await expect(canvas).toBeHidden()
    await page.locator('.editor-tabs li[aria-label="发布流程.excalidraw"] button').click()
    await expect(page.locator('.editor-tabs li')).toHaveCount(1)
    await preview.dblclick()
    await expect(canvas.locator('canvas.interactive')).toBeVisible()
    await expect(page.locator('.editor-tabs li.active')).toHaveText('发布流程.excalidraw')
  } finally {
    await app.close()
  }
})
