import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { blankDrawing } from '../../src/shared/drawing'
import type { MenuTemplate } from '../../src/shared/types/menu'
import { clickMenuById, enterSourceMode, getMarkdownContent, launchElectron, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const blankDrawingFence = `\`\`\`excalidraw\n${blankDrawing}\n\`\`\``
const blankInlineDrawing = `![Embedded drawing](data:application/x-excalidraw;base64,${Buffer.from(blankDrawing).toString('base64')})`

function inlineScenes(markdown: string) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(data:application\/x-excalidraw;base64,([\w+/=]+)\)/g)]
    .map(([, source]) => JSON.parse(Buffer.from(source, 'base64').toString('utf8')))
}

test('places the caret between each pair of consecutive drawings', async() => {
  const { app, page } = await launchWithMarkdown(blankInlineDrawing.repeat(3), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const drawings = page.locator('.mu-editor .mu-inline-drawing')
    const gaps = page.locator('.mu-editor .mu-drawing-gap')
    await expect(drawings.getByRole('img')).toHaveCount(3)
    await expect(gaps).toHaveCount(2)
    await drawings.first().focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await expect(drawings.nth(1).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.press('ArrowRight')
    await expect(drawings.nth(2).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.press('ArrowLeft')
    await expect(drawings.nth(1).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.insertText('一')
    await expect(gaps).toHaveCount(1)
    const [gap, second] = await Promise.all([gaps.boundingBox(), drawings.nth(1).boundingBox()])
    if (!gap || !second) throw new Error('Missing drawing or gap bounds')
    await page.mouse.click(gap.x + gap.width / 2, second.y + second.height / 2)
    await expect(page.getByRole('dialog', { name: 'Embedded drawing' })).toBeHidden()
    await page.keyboard.insertText('二')
    await expect(drawings).toHaveCount(3)
    expect((await getMarkdownContent(page, app)).trim()).toBe(`${blankInlineDrawing}一${blankInlineDrawing}二${blankInlineDrawing}`)
  } finally {
    await app.close()
  }
})

test('puts an editable caret between consecutive legacy drawing fences', async() => {
  const fences = Array.from({ length: 3 }, (_, index) =>
    blankDrawingFence.replace('"appState":{}', `"appState":{"viewBackgroundColor":"#eeee0${index}"}`))
  const { app, page } = await launchWithMarkdown(['Before', ...fences, 'After'].join('\n\n'), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawings = editor.locator('.mu-embedded-drawing-block')
    const gaps = editor.locator('.mu-embedded-drawing-gap:visible')
    await expect(drawings.getByRole('img')).toHaveCount(3)
    await expect(gaps).toHaveCount(2)
    await gaps.first().click()
    await expect(page.getByRole('dialog', { name: 'Embedded drawing' })).toBeHidden()
    await page.keyboard.insertText('第一处')
    await expect(drawings.nth(0).locator('xpath=following-sibling::*[1]')).toHaveText('第一处')

    await drawings.nth(2).getByRole('button').focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.insertText('第二处')
    await expect(drawings.nth(1).locator('xpath=following-sibling::*[1]')).toHaveText('第二处')
    expect((await getMarkdownContent(page, app)).trim())
      .toBe(['Before', fences[0], '第一处', fences[1], '第二处', fences[2], 'After'].join('\n\n'))
  } finally {
    await app.close()
  }
})

test('places a caret beside a legacy drawing and keeps the scene when typing inline', async() => {
  const { app, page } = await launchWithMarkdown(Array(3).fill(blankDrawingFence).join('\n\n'), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const legacy = editor.locator('.mu-embedded-drawing-block')
    const inline = editor.locator('.mu-inline-drawing')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    const preview = legacy.nth(1).getByRole('img')
    await expect(preview).toBeVisible()
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing legacy preview bounds')
    await page.mouse.click(bounds.x - 12, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await expect(inline).toBeVisible()
    await clickMenuById(app, 'undoMenuItem')
    await expect(legacy).toHaveCount(3)

    await expect(preview).toBeVisible()
    const restored = await preview.boundingBox()
    if (!restored) throw new Error('Missing restored preview bounds')
    await page.mouse.click(restored.x + restored.width + 12, restored.y + restored.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('右侧')
    await inline.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.insertText('左侧')
    expect((await getMarkdownContent(page, app)).trim()).toBe(
      [blankDrawingFence, `左侧${blankInlineDrawing}右侧`, blankDrawingFence].join('\n\n')
    )
  } finally {
    await app.close()
  }
})

test('shows source drawings as atomic chips and opens the drawing under the clicked chip', async() => {
  const sourceMarkdown = `${blankInlineDrawing.repeat(2)}\n\n> ${blankDrawingFence.replace(/\n/g, '\n> ')}\n\n![Linked](linked.excalidraw)\n`
  const { app, page, filePath } = await launchWithMarkdown(sourceMarkdown, {
    preferences: { language: 'en', autoSave: false, theme: 'pine-ink', followSystemTheme: false }
  })
  try {
    await writeFile(join(dirname(filePath), 'linked.excalidraw'), blankDrawing)
    await enterSourceMode(page, app)
    const source = page.locator('.source-code .CodeMirror')
    const chips = source.locator('.embedded-drawing-chip')
    await expect(chips).toHaveCount(4)
    await expect(chips.first()).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(source.locator('.CodeMirror-code')).toHaveText(/^(?![\s\S]*(?:base64|appState|\x60{3}))[\s\S]*$/)
    expect((await getMarkdownContent(page, app)).trim()).toBe(sourceMarkdown.trim())

    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await chips.nth(1).click()
    await popup.getByRole('tab', { name: 'Source' }).click()
    const editor = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await editor.inputValue())
    scene.appState.viewBackgroundColor = '#ccbbaa'
    await editor.fill(JSON.stringify(scene))
    await popup.click({ position: { x: 8, y: 8 } })
    const confirm = page.locator('.el-message-box').filter({ hasText: 'Discard the unapplied changes to the drawing source?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(popup).toBeVisible()
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[1]?.appState.viewBackgroundColor).toBe('#ccbbaa')
    const updated = await getMarkdownContent(page, app)
    expect(inlineScenes(updated)[0]).toEqual(JSON.parse(blankDrawing))
    expect(updated).toContain('> ```excalidraw')
    await popup.click({ position: { x: 8, y: 8 } })
    await expect(popup).toBeHidden()

    await chips.nth(2).click()
    await expect(popup).toBeVisible()
    await popup.click({ position: { x: 8, y: 8 } })
    await expect(popup).toBeHidden()
    await chips.nth(3).click()
    const linked = page.getByRole('dialog', { name: 'linked.excalidraw' })
    await expect(linked).toBeVisible()
    await linked.click({ position: { x: 8, y: 8 } })
    await expect(linked).toBeHidden()

    await source.evaluate((element, ch) => {
      const cm = (element as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror
      cm.focus()
      cm.setCursor({ line: 0, ch })
    }, blankInlineDrawing.length)
    await page.keyboard.insertText('之间')
    expect((await getMarkdownContent(page, app)).startsWith(`${blankInlineDrawing}之间![Embedded drawing](`)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Backspace')
    await expect(chips).toHaveCount(3)
    expect(inlineScenes(await getMarkdownContent(page, app))).toEqual([JSON.parse(blankDrawing)])
  } finally {
    await app.close()
  }
})

test('keeps an inline drawing between editable text and opens only from the preview', async() => {
  const { app, page } = await launchWithMarkdown(`Before ${blankInlineDrawing} After\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const paragraph = editor.locator('.mu-paragraph')
    const drawing = paragraph.locator('.mu-inline-drawing')
    const preview = drawing.getByRole('img')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(preview).toBeVisible()
    await expect(paragraph).toHaveText('Before After')
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing preview bounds')
    await page.mouse.click(bounds.x - 4, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('Left')
    await expect(paragraph).toHaveText(/^Before\s*Left\s*After$/)
    await drawing.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('Right')
    await expect(paragraph).toHaveText(/Right After$/)
    await drawing.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(paragraph).toHaveCount(2)
    await expect(paragraph.nth(1).locator('.mu-inline-drawing')).toBeVisible()
    await drawing.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(paragraph).toHaveCount(3)
    await expect(paragraph.nth(1)).toHaveText('')
    await expect(paragraph.nth(2)).toHaveText('Right After')
    await clickMenuById(app, 'undoMenuItem')
    await expect(paragraph).toHaveCount(2)
    await clickMenuById(app, 'undoMenuItem')
    await expect(paragraph).toHaveCount(1)
    await preview.click()
    await expect(popup).toBeVisible()
  } finally {
    await app.close()
  }
})

test('saves only the clicked inline drawing among identical scenes', async() => {
  const markdown = `${blankDrawingFence}\n\n${blankInlineDrawing}\n\n> Before ${blankInlineDrawing} After\n`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const drawings = page.locator('.mu-editor .mu-inline-drawing')
    await expect(drawings).toHaveCount(2)
    await drawings.nth(1).focus()
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await source.inputValue())
    scene.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(scene))
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[1]?.appState.viewBackgroundColor).toBe('#ffeedd')
    const saved = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n')
    expect(saved).toContain(blankDrawingFence)
    expect(inlineScenes(saved)[0]).toEqual(JSON.parse(blankDrawing))

    await popup.locator('.el-dialog__headerbtn').click()
    const htmlPath = join(dirname(filePath), 'inline-drawing.html')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: path })
    }, htmlPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'styledHtml')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(() => readFile(htmlPath, 'utf8').catch(() => '')).toMatch(/<p>Before <img[^>]+src="data:image\/png;base64,[^>]+> After<\/p>/)
  } finally {
    await app.close()
  }
})

test('rebases an open embedded drawing onto external document edits', async() => {
  const markdown = `${blankInlineDrawing}\n\n> Before ${blankInlineDrawing} After\n`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async() => ({ response: 1, checkboxChecked: false })
    })
    await page.locator('.mu-editor .mu-inline-drawing').nth(1).getByRole('img').click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await source.inputValue())
    scene.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(scene))
    const apply = popup.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeEnabled()

    await writeFile(filePath, `Changed by another editor\n\n${markdown}\nMore text from another editor\n`)
    await apply.click()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[1]?.appState.viewBackgroundColor).toBe('#ffeedd')
    const saved = await readFile(filePath, 'utf8')
    expect(saved).toMatch(/^Changed by another editor\r?\n/)
    expect(saved).toContain('More text from another editor')
    expect(inlineScenes(saved)[0]).toEqual(JSON.parse(blankDrawing))
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    await expect(page.locator('.editor-notifications')).toBeHidden()
  } finally {
    await app.close()
  }
})

test('keeps an open drawing edit when the original drawing changes on disk', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`${blankInlineDrawing}\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async() => ({ response: 1, checkboxChecked: false })
    })
    await page.locator('.mu-editor .mu-inline-drawing').getByRole('img').click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await source.inputValue())
    scene.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(scene))
    const apply = popup.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeEnabled()

    const external = 'Drawing removed in another editor\n'
    await writeFile(filePath, external)
    await apply.click()
    await expect(popup.getByRole('alert')).toContainText('Your drawing edits are still open.')
    await expect(source).toHaveValue(/#ffeedd/)
    expect(await readFile(filePath, 'utf8')).toBe(external)
    await popup.getByRole('tab', { name: 'Canvas' }).click()
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.drawing-workspace:visible')
    await drawing.getByRole('tab', { name: 'Source' }).click()
    await expect(drawing.getByRole('textbox', { name: 'Excalidraw JSON' })).toHaveValue(/#ffeedd/)
  } finally {
    await app.close()
  }
})

test('undoes and redoes canvas edits with the keyboard and the edit menu', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`${blankInlineDrawing}\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await page.locator('.mu-editor .mu-inline-drawing').getByRole('img').click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    const drawRectangle = async(workspace: Locator) => {
      await workspace.locator('label').filter({ has: page.getByTestId('toolbar-rectangle') }).click()
      const canvas = await workspace.locator('canvas.interactive').boundingBox()
      if (!canvas) throw new Error('Missing drawing canvas bounds')
      const x = canvas.x + canvas.width / 2
      const y = canvas.y + canvas.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 80, y + 50, { steps: 5 })
      await page.mouse.up()
    }
    await drawRectangle(popup)
    const undo = popup.getByTestId('button-undo')
    const elementCount = async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements.length
    await expect(undo).toBeEnabled()
    await expect.poll(elementCount).toBe(1)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(elementCount).toBe(0)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(elementCount).toBe(1)

    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.drawing-workspace:visible')
    await drawRectangle(drawing)
    await expect(drawing.getByTestId('button-undo')).toBeEnabled()
    await expect.poll(elementCount).toBe(2)
    await clickMenuById(app, 'undoMenuItem')
    await expect.poll(elementCount).toBe(1)
    await clickMenuById(app, 'redoMenuItem')
    await expect.poll(elementCount).toBe(2)
  } finally {
    await app.close()
  }
})

test('places an editable caret on both sides of a drawing at the document boundary', async() => {
  const { app, page } = await launchWithMarkdown(blankDrawingFence, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawing = editor.locator('.mu-embedded-drawing-block')
    const preview = drawing.getByRole('img')
    await expect(preview).toBeVisible()
    await drawing.getByRole('button').focus()
    await expect(drawing.getByRole('button')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const after = editor.locator('.mu-embedded-drawing-block + .mu-paragraph')
    await expect(after).toBeVisible()
    await page.keyboard.insertText('After')
    await expect(after).toHaveText('After')

    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    const before = editor.locator('.mu-paragraph:has(+ .mu-embedded-drawing-block)')
    await expect(before).toBeVisible()
    await page.keyboard.insertText('Before')
    await expect(before).toHaveText('Before')

    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('Still ')
    await expect(after).toHaveText('Still After')
  } finally {
    await app.close()
  }
})

test('deletes an adjacent drawing without losing the caret or jumping to the top', async() => {
  const prefix = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  const markdown = `${prefix}\n\nBefore the drawing\n\n${blankDrawingFence}\n\nAfter the drawing\n`
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawing = editor.locator('.mu-embedded-drawing-block')
    const before = editor.getByText('Before the drawing', { exact: true })
    const after = editor.getByText('After the drawing', { exact: true })
    const scrollTop = () => editor.evaluate(element => element.scrollTop)
    const caret = () => page.evaluate(() => {
      const selection = document.getSelection()
      return [selection?.anchorNode?.textContent, selection?.anchorOffset]
    })

    await after.click()
    await page.keyboard.press('Home')
    await expect.poll(scrollTop).toBeGreaterThan(500)
    await page.keyboard.press('Backspace')
    await expect(drawing).toHaveCount(0)
    await expect.poll(caret).toEqual(['After the drawing', 0])
    await expect.poll(scrollTop).toBeGreaterThan(500)

    await clickMenuById(app, 'undoMenuItem')
    await expect(drawing.getByRole('img')).toBeVisible()
    await before.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Delete')
    await expect(drawing).toHaveCount(0)
    await expect.poll(caret).toEqual(['Before the drawing', 'Before the drawing'.length])
    await expect(after).toBeVisible()
    await expect.poll(scrollTop).toBeGreaterThan(500)
  } finally {
    await app.close()
  }
})

test('keeps the document scroll position when inserting a drawing and closing immediately', async() => {
  const paragraphs = Array.from({ length: 50 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  const { app, page, filePath } = await launchWithMarkdown(`Insert here\n\n${paragraphs}\n`, {
    preferences: { language: 'en', autoSave: false, embedDrawings: true }
  })
  try {
    const editor = page.locator('.mu-editor')
    await editor.getByText('Insert here', { exact: true }).click()
    await page.keyboard.press('End')
    const scrollTop = await editor.evaluate(element => {
      element.scrollTop = 800
      return element.scrollTop
    })
    expect(scrollTop).toBeGreaterThan(500)

    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'drawing.insert')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    expect(await editor.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)
    expect(await readFile(filePath, 'utf8')).toContain('Insert here![Embedded drawing](')
  } finally {
    await app.close()
  }
})

test('keeps the document scroll position after editing an existing drawing', async() => {
  const paragraphs = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  const { app, page, filePath } = await launchWithMarkdown(`${paragraphs}\n\n${blankInlineDrawing}\n\nAfter\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    await editor.getByText('Paragraph 1', { exact: true }).click()
    const preview = editor.getByRole('img', { name: 'Embedded drawing' })
    await preview.scrollIntoViewIfNeeded()
    const scrollTop = await editor.evaluate(element => element.scrollTop)
    expect(scrollTop).toBeGreaterThan(500)

    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await source.inputValue())
    scene.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(scene))
    await popup.getByRole('button', { name: 'Apply' }).click()
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    expect(await editor.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)
    expect(inlineScenes(await readFile(filePath, 'utf8'))[0].appState.viewBackgroundColor).toBe('#ffeedd')
  } finally {
    await app.close()
  }
})

test('embeds drawings by default and edits them after reopening the Markdown', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Release plan\n\n- Check the build\n', { preferences: { language: 'en', autoSave: false } })
  const directory = dirname(filePath)
  const cardPath = join(directory, 'notes', 'release-plan.md')
  const copyPath = join(directory, 'drawing-copy.md')
  const pdfPath = join(directory, 'embedded-drawing.pdf')
  const readScene = async(pathname: string) => {
    const markdown = await readFile(pathname, 'utf8')
    return inlineScenes(markdown)[0]
  }
  try {
    await mkdir(dirname(cardPath), { recursive: true })
    await writeFile(cardPath, '# Release plan\n\n- Check the build\n')
    await writeFile(join(directory, basename(cardPath)), '# Other document\n')
    await page.evaluate(path => window.electron.ipcRenderer.send('mt::window::drop', [path]), directory)
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
    }, cardPath)
    await clickMenuById(app, 'newDrawingMenuItem')
    const canvas = page.locator('.drawing-workspace:visible')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    const addCard = async(browse = false) => {
      await canvas.getByRole('button', { name: 'Add Document' }).click()
      if (browse) {
        await canvas.getByRole('button', { name: 'Browse Files…' }).click()
      } else {
        const search = canvas.getByRole('combobox', { name: 'Search Markdown documents' })
        await search.fill('notes/release')
        await canvas.getByRole('option', { name: /release-plan\.md.*notes/ }).click()
      }
      await canvas.getByLabel(basename(cardPath)).selectOption('release-plan')
      await canvas.getByRole('button', { name: 'Add Card', exact: true }).click()
    }
    await addCard()
    await canvas.getByRole('button', { name: 'Insert into Document' }).click()
    await expect(canvas).toBeHidden()

    const preview = page.getByRole('img', { name: 'Embedded drawing' })
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => readScene(filePath)).toMatchObject({
      type: 'excalidraw',
      elements: [{ type: 'image' }]
    })
    const scene = await readScene(filePath)
    expect(scene.files[scene.elements[0].fileId].dataURL).toMatch(/^data:image\/png;base64,/)
    expect((await readdir(directory)).filter(name => name.endsWith('.excalidraw'))).toEqual([])

    await writeFile(copyPath, await readFile(filePath))
    await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, { preview: false }), copyPath)
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(copyPath))
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await preview.click()
    await expect(popup).toBeVisible()
    const toolbar = popup.locator('.drawing-toolbar')
    await expect(toolbar.getByRole('tablist')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Add Document' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Open in Tab' })).toBeVisible()
    await expect(popup.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const initial = JSON.parse(await source.inputValue())
    expect(initial.elements).toHaveLength(1)
    await source.fill('{')
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect(popup.getByRole('alert')).toContainText('The drawing source is invalid')
    expect((await readScene(copyPath)).appState.viewBackgroundColor).toBe(initial.appState.viewBackgroundColor)
    await popup.getByRole('button', { name: 'Discard changes' }).click()
    expect(JSON.parse(await source.inputValue())).toEqual(initial)
    initial.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(initial))
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => (await readScene(copyPath)).appState.viewBackgroundColor).toBe('#ffeedd')
    await popup.getByRole('tab', { name: 'Canvas' }).click()
    await addCard(true)
    await expect.poll(async() => (await readScene(copyPath))?.elements.length).toBe(2)
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    const drawingTab = page.locator('.editor-tabs li.active')
    await expect(drawingTab).toHaveText('Embedded drawing.excalidraw')
    await addCard()
    await drawingTab.locator('.close-icon').click()
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(copyPath))
    await expect.poll(async() => (await readScene(copyPath))?.elements.length).toBe(3)
    expect((await readScene(filePath)).elements).toHaveLength(1)

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, pdfPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(async() => {
      const pdf = await readFile(pdfPath).catch(() => Buffer.alloc(0))
      return { size: pdf.length, image: /\/Subtype\s*\/Image\b/.test(pdf.toString('latin1')) }
    }, { timeout: 8000 }).toMatchObject({ image: true })
  } finally {
    await app.close()
  }
})

test('inserts a drawing from the context menu and autosaves edits to the linked file', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# 发布清单\n\n- 检查构建\n', {
    preferences: { language: 'en', embedDrawings: false, newDrawingView: 'tab', autoSave: false }
  })
  const occupiedPath = join(dirname(filePath), 'Untitled Drawing.excalidraw')
  const drawingPath = join(dirname(filePath), 'Untitled Drawing 2.excalidraw')
  const pdfPath = join(dirname(filePath), 'drawing-export.pdf')
  try {
    await writeFile(occupiedPath, 'existing drawing')
    await app.evaluate(({ dialog, ipcMain }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: true, filePath: '' })
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
      ipcMain.removeAllListeners('mt::menu::popup')
      ipcMain.on('mt::menu::popup', (event, template: MenuTemplate) => {
        const item = template.find(item => item.id?.startsWith('newDrawing-') && item.enabled)
        if (item) event.sender.send('mt::menu::click', { id: item.id })
        event.sender.send('mt::menu::closed', {})
      })
    }, filePath)
    await page.locator('.mu-editor').dispatchEvent('contextmenu', { bubbles: true, cancelable: true })

    const canvas = page.locator('.drawing-workspace:visible')
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(drawingPath))
    await expect(canvas.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await expect.poll(() => readFile(filePath, 'utf8')).toContain('Untitled%20Drawing%202.excalidraw)')
    expect(await readFile(occupiedPath, 'utf8')).toBe('existing drawing')
    await expect(page.locator('.editor-tabs')).toBeVisible()
    const tabs = page.locator('.editor-tabs')
    await expect(tabs.getByRole('button', { name: 'New Tab', exact: true })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'New Excalidraw Drawing', exact: true })).toHaveCount(0)
    await expect(page.locator('.editor-tabs li')).toHaveCount(2)
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    const addCard = async() => {
      await canvas.getByRole('button', { name: 'Add Document' }).click()
      await expect(canvas.getByText('Opened files', { exact: true })).toBeVisible()
      await canvas.getByRole('option').filter({ hasText: basename(filePath) }).click()
      await canvas.getByLabel(basename(filePath)).selectOption('发布清单')
      await canvas.getByRole('button', { name: 'Add Card', exact: true }).click()
    }
    await addCard()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(1)
    const drawingTab = page.locator(`.editor-tabs li[aria-label="${basename(drawingPath)}"]`)
    await expect(drawingTab).toBeVisible()
    await drawingTab.locator('.close-icon').click()
    await expect(canvas).toBeHidden()

    const savedDrawing = await readFile(drawingPath, 'utf8')
    const content = JSON.parse(savedDrawing)
    expect(content.type).toBe('excalidraw')
    expect(content.elements).toHaveLength(1)
    const [card] = content.elements
    expect(card.customData.autumnmarkDocument).toEqual({ path: basename(filePath), heading: '发布清单' })
    expect(content.files[card.fileId].dataURL).toMatch(/^data:image\/png;base64,/)

    const preview = page.getByRole('img', { name: 'Untitled Drawing 2' })
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => readFile(filePath, 'utf8')).toContain('.excalidraw)')

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, pdfPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(async() => {
      const pdf = await readFile(pdfPath).catch(() => Buffer.alloc(0))
      return /\/Subtype\s*\/Image\b/.test(pdf.toString('latin1'))
    }).toBe(true)

    await preview.click()
    const popup = page.getByRole('dialog', { name: basename(drawingPath) })
    await expect(popup).toBeVisible()
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    await expect(page.locator('.editor-tabs li')).toHaveCount(1)
    await addCard()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(2)
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    await expect(canvas.locator('canvas.interactive')).toBeVisible()
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(drawingPath))
    await addCard()
    await drawingTab.locator('.close-icon').click()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(3)
  } finally {
    await app.close()
  }
})

test('the insertion shortcut respects embedding and transfers a new drawing to a tab', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Draw here', {
    windowLayout: { showTabBar: true },
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const recentPath = join(dirname(filePath), 'previous-plan.md')
    await writeFile(recentPath, '# Previous plan\n')
    await page.evaluate(path => window.electron.ipcRenderer.send('mt::open-file', path, { preview: false }), recentPath)
    const activeTab = page.locator('.editor-tabs li.active')
    await expect(activeTab).toHaveText(basename(recentPath))
    await expect(activeTab).toBeVisible()
    await activeTab.locator('.close-icon').click()
    await expect(activeTab).toHaveText(basename(filePath))
    await page.locator('.mu-editor .mu-paragraph').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate(win => {
      const modifiers: ('meta' | 'control' | 'shift')[] = [process.platform === 'darwin' ? 'meta' : 'control', 'shift']
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers })
    })
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    await expect.poll(() => readFile(filePath, 'utf8')).toMatch(/Draw!\[Embedded drawing\]\(data:application\/x-excalidraw;base64,[\w+/=]+\) here/)
    await expect(popup.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    const addDocument = popup.getByRole('button', { name: 'Add Document' })
    const documentPanel = popup.getByRole('group', { name: 'Add Document' })
    const search = popup.getByRole('combobox', { name: 'Search Markdown documents' })
    const canvas = popup.locator('.drawing-canvas')
    const canvasLayout = () => canvas.evaluate((element: HTMLDivElement) => ({
      top: element.offsetTop,
      left: element.offsetLeft,
      width: element.offsetWidth,
      height: element.offsetHeight
    }))
    await expect(canvas.locator('canvas.interactive')).toBeVisible()
    const initialCanvasLayout = await canvasLayout()
    await addDocument.click()
    await expect(search).toBeFocused()
    expect(await canvasLayout()).toEqual(initialCanvasLayout)
    await search.press('Escape')
    await expect(popup).toBeVisible()
    await expect(addDocument).toBeFocused()
    await expect(documentPanel).toBeHidden()
    await addDocument.click()
    await expect(search).toBeFocused()
    await popup.getByRole('tab', { name: 'Canvas' }).click()
    await expect(documentPanel).toBeHidden()
    await addDocument.click()
    await expect(popup.getByText('recently opened', { exact: true })).toBeVisible()
    await expect(popup.getByRole('option').filter({ hasText: basename(filePath) })).toHaveCount(1)
    await search.fill('previous-plan')
    await expect(popup.getByRole('option').filter({ hasText: basename(recentPath) })).toBeVisible()
    await search.press('Enter')
    await expect(popup.getByLabel(basename(recentPath))).toBeFocused()
    expect(await canvasLayout()).toEqual(initialCanvasLayout)
    await popup.getByRole('button', { name: 'Add Card', exact: true }).click()
    await expect(documentPanel).toBeHidden()
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    await expect.poll(async() => {
      const markdown = await readFile(filePath, 'utf8')
      return inlineScenes(markdown)[0]?.elements.length
    }).toBe(1)
    expect((await readdir(dirname(filePath))).filter(name => name.endsWith('.excalidraw'))).toEqual([])
  } finally {
    await app.close()
  }
})

test('inserts an embedded drawing in an untitled note without opening Save As', async() => {
  const { app, page } = await launchElectron([], {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const saveDialogs = await app.evaluateHandle(({ dialog }) => {
      const calls: string[] = []
      dialog.showSaveDialog = async() => {
        calls.push('save')
        return { canceled: true, filePath: '' }
      }
      return calls
    })
    await expect(page.locator('.mu-editor .mu-paragraph')).toBeVisible()
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'drawing.insert')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.mu-inline-drawing')
    const preview = drawing.getByRole('img')
    await expect(preview).toBeVisible()
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing preview bounds')
    await page.mouse.click(bounds.x + bounds.width + 8, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('右')
    await drawing.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.insertText('左')
    await expect(page.locator('.mu-editor .mu-paragraph')).toHaveText('左右')
    expect(await saveDialogs.jsonValue()).toEqual([])
  } finally {
    await app.close()
  }
})

test('the /excel slash query inserts an embedded drawing at the paragraph in a quote', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Before\n\n> Quote\n\nAfter\n', {
    preferences: { language: 'zh-CN', embedDrawings: true, autoSave: false }
  })
  try {
    const logDirectory = await app.evaluate(({ app }) => {
      const now = new Date()
      return `${app.getPath('userData')}/logs/${now.getFullYear()}${now.getMonth() + 1}`
    })
    const logFile = join(logDirectory, 'main.log')
    const drawingLogs = async() => (await readFile(logFile, 'utf8').catch(() => ''))
      .split('\n').filter(line => line.includes('[drawing-quick-insert]'))

    await page.locator('.mu-editor blockquote .mu-paragraph').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('/excel')
    const command = page.locator('.mu-quick-insert [data-label="insert-drawing"]')
    await expect(command).toHaveClass(/active/)
    await page.keyboard.press('Escape')
    await expect.poll(async() => (await drawingLogs()).some(line => line.includes('menu-hidden'))).toBe(true)
    const dismissed = (await drawingLogs()).join('\n')
    expect(dismissed).toMatch(/menu-searched[\s\S]*menu-hidden/)
    expect(dismissed).not.toContain('command-selected')

    await page.keyboard.press('Backspace')
    await page.keyboard.insertText('l')
    await expect(command).toHaveClass(/active/)
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: '内嵌绘图' })
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('button', { name: '插入到文档' })).toHaveCount(0)
    await expect.poll(async() => (await drawingLogs()).some(line => line.includes('canvas-ready'))).toBe(true)
    const logLines = await drawingLogs()
    const traceId = /\[drawing-quick-insert\]\s+(\S+)\s+canvas-ready\b/.exec(logLines.join('\n'))?.[1]
    expect(traceId).toBeTruthy()
    const trace = logLines.filter(line => line.includes(`[drawing-quick-insert] ${traceId} `)).join('\n')
    expect(trace).toMatch(/menu-searched[\s\S]*command-selected[\s\S]*markdown-updated[\s\S]*note-save-result[\s\S]*canvas-ready/)
    expect(trace).not.toMatch(/Quote|base64|\.md\b/)
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.mu-editor blockquote .mu-inline-drawing')
    await expect(drawing.getByRole('img', { name: '内嵌绘图' })).toBeVisible()
    await expect.poll(async() => (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n'))
      .toMatch(/^Before\n\n> Quote\n>[^\n]*\n> !\[内嵌绘图\]\(data:application\/x-excalidraw;base64,[\w+/=]+\)\n\nAfter\n?$/)
  } finally {
    await app.close()
  }
})

test('the slash menu creates a sibling drawing in a tab when embedding is disabled', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Draw here', { preferences: { language: 'en' } })
  try {
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await opened
    await settings.locator('.pref-sidebar input').fill('embedDrawings')
    await settings.locator('.pref-autocomplete li').first().click()
    const embed = settings.getByRole('switch', { name: 'Embed drawings in Markdown' })
    await expect(embed).toBeChecked()
    await settings.locator('#setting-embedDrawings .el-switch').click()
    await expect(embed).not.toBeChecked()
    await expect.poll(() => page.evaluate(async() => {
      const preferences = await window.electron.ipcRenderer.invoke('mt::preferences::get')
      return preferences.embedDrawings
    })).toBe(false)
    const view = settings.locator('#setting-newDrawingView')
    await expect(view).toContainText('Floating editor')
    await view.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: 'New tab', exact: true }).click()
    await expect.poll(() => page.evaluate(async() => {
      const preferences = await window.electron.ipcRenderer.invoke('mt::preferences::get')
      return preferences.newDrawingView
    })).toBe('tab')
    const nativeSettings = await app.browserWindow(settings)
    await nativeSettings.evaluate(window => window.close())
    const paragraph = page.locator('.mu-editor .mu-paragraph').first()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/excalidraw')
    const filename = 'Untitled Drawing.excalidraw'
    const occupiedPath = join(dirname(filePath), filename)
    await writeFile(occupiedPath, 'existing drawing')
    await page.locator('.mu-quick-insert [data-label="insert-drawing"]').click()
    await expect(page.locator('.editor-tabs li.active')).toHaveText('Untitled Drawing 2.excalidraw')
    await expect(page.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await expect.poll(async() => readFile(filePath, 'utf8')).toMatch(/Draw here\s+!\[.*\]\(Untitled%20Drawing%202\.excalidraw\)/)
    expect(await readFile(occupiedPath, 'utf8')).toBe('existing drawing')
    expect(JSON.parse(await readFile(join(dirname(filePath), 'Untitled Drawing 2.excalidraw'), 'utf8'))).toMatchObject({ type: 'excalidraw', elements: [] })
  } finally {
    await app.close()
  }
})

test('flushes the clicked nested drawing on a native window close with identical scenes', async() => {
  const fence = `\`\`\`excalidraw\n${blankDrawing}\n\`\`\``
  const quote = fence.split('\n').map(line => `> ${line}`).join('\n')
  const { app, page, filePath } = await launchWithMarkdown(`${fence}\n\n${quote}\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [path] })
    }, filePath)
    const previews = page.getByRole('img', { name: 'Embedded drawing' })
    await expect(previews).toHaveCount(2)
    await previews.nth(1).click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('button', { name: 'Add Document' }).click()
    await popup.getByRole('button', { name: 'Browse Files…' }).click()
    await popup.getByRole('button', { name: 'Add Card', exact: true }).click()
    const native = await app.browserWindow(page)
    const closed = page.waitForEvent('close')
    await native.evaluate(window => window.close())
    await closed
    const markdown = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n')
    expect(markdown).toContain(fence)
    const nested = /^> ```excalidraw\n([\s\S]*?)\n> ```$/m.exec(markdown)?.[1]
    expect(nested && JSON.parse(nested.replace(/^> /gm, '')).elements).toMatchObject([{ type: 'image' }])
  } finally {
    await app.close()
  }
})

test('keeps the text input focused in the embedded drawing dialog across auto-save pauses', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`Before\n\n${blankInlineDrawing}\n\nAfter\n`, {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const preview = page.locator('.mu-editor .mu-inline-drawing img')
    await expect(preview).toBeVisible()
    await page.locator('.mu-editor .mu-paragraph').first().click()
    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    const interactive = popup.locator('canvas.interactive')
    await expect(interactive).toBeVisible()

    const beforeDisk = await readFile(filePath, 'utf8')
    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    const box = await interactive.boundingBox()
    if (!box) throw new Error('Missing interactive canvas bounds')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    const wysiwyg = popup.locator('textarea.excalidraw-wysiwyg')
    await expect(wysiwyg).toBeVisible()
    await expect(wysiwyg).toBeFocused()
    await page.waitForTimeout(600)
    await expect(wysiwyg).toBeFocused()
    expect(await readFile(filePath, 'utf8')).toBe(beforeDisk)

    await page.keyboard.insertText('Hello ')
    await page.waitForTimeout(600)
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText('world')
    await page.keyboard.press('Escape')
    await expect(wysiwyg).toBeHidden()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'Hello world' }])
  } finally {
    await app.close()
  }
})

test('explicit save keeps text editing focused and omits uncommitted empty text and bindings', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`Before\n\n${blankInlineDrawing}\n\nAfter\n`, {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const preview = page.locator('.mu-editor .mu-inline-drawing img')
    await expect(preview).toBeVisible()
    await page.locator('.mu-editor .mu-paragraph').first().click()
    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    const interactive = popup.locator('canvas.interactive')
    await expect(interactive).toBeVisible()
    const box = await interactive.boundingBox()
    if (!box) throw new Error('Missing interactive canvas bounds')

    const shortcut = process.platform === 'darwin' ? 'Meta+s' : 'Control+s'
    const wysiwyg = popup.locator('textarea.excalidraw-wysiwyg')

    // Unbound empty text: Ctrl+S keeps focus and leaves disk bytes untouched.
    const beforeEmptyDisk = await readFile(filePath, 'utf8')
    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3)
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.press(shortcut)
    await page.waitForTimeout(450)
    await expect(wysiwyg).toBeFocused()
    expect(await readFile(filePath, 'utf8')).toBe(beforeEmptyDisk)

    // Non-empty text: Ctrl+S persists live text while keeping the text box focused.
    await page.keyboard.insertText('Saved inline')
    await page.keyboard.press(shortcut)
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'Saved inline' }])
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText(' more')
    await page.keyboard.press('Escape')
    await expect(wysiwyg).toBeHidden()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'Saved inline more' }])

    // Bound empty text inside a rectangle: Ctrl+S strips both the empty text and the container's boundElements ref.
    await popup.locator('input[data-testid="toolbar-rectangle"]').click({ force: true })
    const rectStartX = box.x + box.width * 0.55
    const rectStartY = box.y + box.height * 0.45
    const rectEndX = box.x + box.width * 0.8
    const rectEndY = box.y + box.height * 0.72
    await page.mouse.move(rectStartX, rectStartY)
    await page.mouse.down()
    await page.mouse.move(rectEndX, rectEndY, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements.length).toBe(2)

    await page.mouse.dblclick((rectStartX + rectEndX) / 2, (rectStartY + rectEndY) / 2)
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.press(shortcut)
    await page.waitForTimeout(450)
    await expect(wysiwyg).toBeFocused()
    const savedAfterBoundEmpty = inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements ?? []
    expect(savedAfterBoundEmpty).toHaveLength(2)
    const savedRect = savedAfterBoundEmpty.find((el: { type: string }) => el.type === 'rectangle')
    expect(savedRect?.boundElements ?? null).toBeNull()

    await page.keyboard.insertText('Inside box')
    await page.keyboard.press('Escape')
    await expect(wysiwyg).toBeHidden()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', originalText: 'Inside box' }),
        expect.objectContaining({ type: 'rectangle', boundElements: expect.arrayContaining([expect.objectContaining({ type: 'text' })]) })
      ]))
  } finally {
    await app.close()
  }
})

test('commits or discards active canvas text cleanly on native close and open-in-tab flush', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`Before\n\n${blankInlineDrawing}\n\nAfter\n`, {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const preview = page.locator('.mu-editor .mu-inline-drawing img')
    await expect(preview).toBeVisible()
    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    const interactive = popup.locator('canvas.interactive')
    await expect(interactive).toBeVisible()
    const box = await interactive.boundingBox()
    if (!box) throw new Error('Missing interactive canvas bounds')

    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4)
    const wysiwyg = popup.locator('textarea.excalidraw-wysiwyg')
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText('Flushed to tab')
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'Flushed to tab' }])

    // Reopen dialog, leave an uncommitted empty text box open, and close the window natively.
    const tabClose = page.locator('.editor-tabs li.active .close-icon')
    await tabClose.click()
    await preview.click()
    await expect(popup).toBeVisible()
    await expect(interactive).toBeVisible()
    const box2 = await interactive.boundingBox()
    if (!box2) throw new Error('Missing reopened canvas bounds')
    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    await page.mouse.click(box2.x + box2.width * 0.7, box2.y + box2.height * 0.7)
    await expect(wysiwyg).toBeFocused()

    const native = await app.browserWindow(page)
    const closed = page.waitForEvent('close')
    await native.evaluate(win => win.close())
    await closed
    const finalElements = inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements ?? []
    expect(finalElements).toMatchObject([{ type: 'text', originalText: 'Flushed to tab' }])
  } finally {
    await app.close()
  }
})

test('preserves canvas text focus during an external disk reload of the underlying note', async() => {
  const initialMarkdown = `Before reload\n\n${blankInlineDrawing}\n\nAfter\n`
  const { app, page, filePath } = await launchWithMarkdown(initialMarkdown, {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const preview = page.locator('.mu-editor .mu-inline-drawing img')
    await expect(preview).toBeVisible()
    await page.locator('.mu-editor .mu-paragraph').first().click()
    await page.waitForTimeout(300)
    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    const interactive = popup.locator('canvas.interactive')
    await expect(interactive).toBeVisible()
    const box = await interactive.boundingBox()
    if (!box) throw new Error('Missing interactive canvas bounds')

    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const wysiwyg = popup.locator('textarea.excalidraw-wysiwyg')
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText('During ')

    // Trigger the real file watcher reload while the text editor is active.
    await writeFile(filePath, `Reloaded outside\n\n${blankInlineDrawing}\n\nAfter\n`, 'utf8')
    await expect.poll(() => page.evaluate(() => document.querySelector('.mu-editor')?.textContent ?? ''), { timeout: 8000 })
      .toContain('Reloaded outside')

    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText('reload')
    await page.keyboard.press('Escape')
    await expect(wysiwyg).toBeHidden()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'During reload' }])
  } finally {
    await app.close()
  }
})

test('preserves canvas text focus when the underlying note has a table rectangle selection', async() => {
  const tableMarkdown = '| A | B |\n| --- | --- |\n| C | D |\n\nAfter table\n'
  const { app, page, filePath } = await launchWithMarkdown(tableMarkdown, {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const cells = page.locator('.mu-editor table td, .mu-editor table th')
    await expect(cells).toHaveCount(4)
    const firstBox = await cells.nth(0).boundingBox()
    const lastBox = await cells.nth(3).boundingBox()
    if (!firstBox || !lastBox) throw new Error('Missing table cell bounds')
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(page.locator('.mu-editor .mu-table-cell-selected')).toHaveCount(4)

    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'drawing.insert')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    const interactive = popup.locator('canvas.interactive')
    await expect(interactive).toBeVisible()
    const box = await interactive.boundingBox()
    if (!box) throw new Error('Missing interactive canvas bounds')

    await popup.locator('input[data-testid="toolbar-text"]').click({ force: true })
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const wysiwyg = popup.locator('textarea.excalidraw-wysiwyg')
    await expect(wysiwyg).toBeFocused()
    await page.keyboard.insertText('Table safe')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements)
      .toMatchObject([{ type: 'text', originalText: 'Table safe' }])
    await expect(wysiwyg).toBeFocused()
  } finally {
    await app.close()
  }
})

async function drawShape(page: Page, popup: Locator, tool: string, offsetX = 0, offsetY = 0) {
  await popup.locator('label').filter({ has: page.getByTestId(tool) }).click()
  const canvas = await popup.locator('canvas.interactive').boundingBox()
  if (!canvas) throw new Error('Missing drawing canvas bounds')
  const x = canvas.x + canvas.width / 2 + offsetX
  const y = canvas.y + canvas.height / 2 + offsetY
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 70, y + 40, { steps: 5 })
  await page.mouse.up()
}

for (const autoSave of [false, true]) {
  test(`keeps a long document scrolled when a drawing autosaves two new elements (autoSave ${autoSave})`, async() => {
    const front = Array.from({ length: 45 }, (_, index) => `Front ${index + 1}. ${'scroll '.repeat(18)}`).join('\n\n')
    const back = Array.from({ length: 25 }, (_, index) => `Back ${index + 1}. ${'tail '.repeat(12)}`).join('\n\n')
    const { app, page, filePath } = await launchWithMarkdown(`${front}\n\n${blankInlineDrawing}\n\n${back}\n`, {
      preferences: { language: 'en', autoSave, embedDrawings: true }
    })
    try {
      const scroller = page.locator('.editor-component')
      const preview = page.locator('.mu-editor').getByRole('img', { name: 'Embedded drawing' })
      await preview.scrollIntoViewIfNeeded()
      const beforeScrollTop = await scroller.evaluate(element => element.scrollTop)
      expect(beforeScrollTop).toBeGreaterThan(1000)

      await preview.click()
      const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
      await expect(popup.locator('canvas.interactive')).toBeVisible()
      const elementCount = async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements.length ?? 0

      await drawShape(page, popup, 'toolbar-rectangle', -120, -40)
      await expect.poll(elementCount).toBe(1)
      const afterFirst = await scroller.evaluate(element => element.scrollTop)
      expect(Math.abs(afterFirst - beforeScrollTop)).toBeLessThan(50)
      expect(afterFirst).toBeGreaterThan(1000)

      await drawShape(page, popup, 'toolbar-ellipse', 40, 20)
      await expect.poll(elementCount).toBe(2)
      const afterSecond = await scroller.evaluate(element => element.scrollTop)
      expect(Math.abs(afterSecond - beforeScrollTop)).toBeLessThan(50)
      expect(afterSecond).toBeGreaterThan(1000)
    } finally {
      await app.close()
    }
  })
}

test('keeps scroll and a folded heading when a mixed document drawing autosaves', async() => {
  const hidden = 'Hidden under the folded heading.'
  const lead = Array.from({ length: 40 }, (_, index) => `Visible ${index + 1}. ${'section '.repeat(16)}`).join('\n\n')
  const markdown = [
    '# Folded chapter',
    '',
    hidden,
    '',
    '# Visible chapter',
    '',
    lead,
    '',
    '```js',
    'const value = 1',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
    '| c | d |',
    '',
    '[ref]: https://example.com',
    '',
    'see [ref]',
    '',
    blankInlineDrawing,
    '',
    blankDrawingFence,
    ''
  ].join('\n')
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false, embedDrawings: true }
  })
  try {
    const folded = page.locator('.editor-component .mu-folded-content')
    await page.locator('.mu-fold-toggle').first().click()
    await expect(folded).toHaveCount(1)
    await expect(page.getByText(hidden)).toBeHidden()

    const scroller = page.locator('.editor-component')
    const drawings = page.locator('.mu-editor').getByRole('img', { name: 'Embedded drawing' })
    const preview = drawings.first()
    await preview.scrollIntoViewIfNeeded()
    const beforeScrollTop = await scroller.evaluate(element => element.scrollTop)
    expect(beforeScrollTop).toBeGreaterThan(1000)

    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup.locator('canvas.interactive')).toBeVisible()
    await drawShape(page, popup, 'toolbar-rectangle')
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements.length ?? 0).toBe(1)

    const afterScrollTop = await scroller.evaluate(element => element.scrollTop)
    expect(Math.abs(afterScrollTop - beforeScrollTop)).toBeLessThan(50)
    expect(afterScrollTop).toBeGreaterThan(1000)
    await expect(folded).toHaveCount(1)
    await expect(page.getByText(hidden)).toBeHidden()
    await expect(page.locator('.mu-editor .mu-fenced-code')).toBeVisible()
    await expect(page.locator('.mu-editor table')).toBeVisible()
    await expect(page.getByText('see [ref]')).toBeVisible()
    await expect(drawings).toHaveCount(2)
  } finally {
    await app.close()
  }
})

test('updates an inline drawing in place during dialog autosave without loading collapse or rebuilding sibling blocks', async() => {
  const markdown = [
    '# Heading',
    '',
    'Unchanged paragraph above.',
    '',
    '```mermaid',
    'graph LR',
    '  A --> B',
    '```',
    '',
    blankInlineDrawing,
    '',
    'Unchanged paragraph below.',
    ''
  ].join('\n')
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false, embedDrawings: true }
  })
  try {
    const drawing = page.locator('.mu-editor .mu-inline-drawing')
    const preview = drawing.getByRole('img', { name: 'Embedded drawing' })
    await expect(preview).toBeVisible()
    await expect(page.locator('.mu-diagram-preview svg')).toBeVisible()

    const beforeSrc = await preview.getAttribute('src')
    await page.evaluate(() => {
      const editor = document.querySelector('.mu-editor')
      if (!editor) throw new Error('Missing editor root')
      const heading = editor.querySelector('h1')
      const mermaidSvg = editor.querySelector('.mu-diagram-preview svg')
      const state = {
        heading,
        mermaidSvg,
        sawLoading: false,
        sawMermaidLoading: false
      }
      ;(window as unknown as Record<string, unknown>).__drawingProbe = state
      const observer = new MutationObserver(() => {
        if (editor.querySelector('.mu-image-loading')) state.sawLoading = true
        const diagram = editor.querySelector('.mu-diagram-preview')
        if (diagram && diagram.textContent?.includes('Loading...')) state.sawMermaidLoading = true
      })
      observer.observe(editor, { attributes: true, childList: true, subtree: true, characterData: true })
      ;(window as unknown as Record<string, unknown>).__drawingObserver = observer
    })

    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup.locator('canvas.interactive')).toBeVisible()

    await drawShape(page, popup, 'toolbar-rectangle', -40, -20)
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[0]?.elements.length ?? 0).toBe(1)
    await expect.poll(() => preview.getAttribute('src')).not.toBe(beforeSrc)
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)

    const probe = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      ;(w.__drawingObserver as MutationObserver | undefined)?.disconnect()
      const state = w.__drawingProbe as {
        heading: Element | null
        mermaidSvg: Element | null
        sawLoading: boolean
        sawMermaidLoading: boolean
      }
      const editor = document.querySelector('.mu-editor')
      if (!editor) throw new Error('Missing editor root')
      return {
        sawLoading: state.sawLoading,
        sawMermaidLoading: state.sawMermaidLoading,
        sameHeading: editor.querySelector('h1') === state.heading,
        sameMermaidSvg: editor.querySelector('.mu-diagram-preview svg') === state.mermaidSvg
      }
    })
    expect(probe).toEqual({
      sawLoading: false,
      sawMermaidLoading: false,
      sameHeading: true,
      sameMermaidSvg: true
    })
  } finally {
    await app.close()
  }
})

test('updates a fenced excalidraw block in place without flashing Loading text', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`Before\n\n${blankDrawingFence}\n\nAfter\n`, {
    preferences: { language: 'en', autoSave: false, embedDrawings: true }
  })
  try {
    const button = page.locator('.mu-editor .mu-embedded-drawing-button')
    const preview = button.locator('img')
    await expect(preview).toBeVisible()
    const beforeSrc = await preview.getAttribute('src')

    await page.evaluate(() => {
      const btn = document.querySelector('.mu-editor .mu-embedded-drawing-button')
      if (!btn) throw new Error('Missing drawing button')
      const state = { sawLoadingText: false, sawMissingImg: false }
      ;(window as unknown as Record<string, unknown>).__fenceProbe = state
      const observer = new MutationObserver(() => {
        if (btn.textContent?.includes('Loading...')) state.sawLoadingText = true
        if (!btn.querySelector('img')) state.sawMissingImg = true
      })
      observer.observe(btn, { childList: true, subtree: true, characterData: true })
      ;(window as unknown as Record<string, unknown>).__fenceObserver = observer
    })

    await preview.click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup.locator('canvas.interactive')).toBeVisible()
    await drawShape(page, popup, 'toolbar-rectangle')

    await expect.poll(async() => {
      const text = await readFile(filePath, 'utf8')
      const match = /```excalidraw\r?\n([\s\S]*?)\r?\n```/.exec(text)
      return match ? JSON.parse(match[1]).elements.length : 0
    }).toBe(1)
    await expect.poll(() => preview.getAttribute('src')).not.toBe(beforeSrc)

    const probe = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      ;(w.__fenceObserver as MutationObserver | undefined)?.disconnect()
      return w.__fenceProbe
    })
    expect(probe).toEqual({ sawLoadingText: false, sawMissingImg: false })
  } finally {
    await app.close()
  }
})

test('updates a linked excalidraw preview without invalidating unrelated images', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`![Linked](./linked.excalidraw)\n\n${blankInlineDrawing}\n`, {
    preferences: { language: 'en', autoSave: false, embedDrawings: false }
  })
  try {
    const linkedPath = join(dirname(filePath), 'linked.excalidraw')
    await writeFile(linkedPath, blankDrawing, 'utf8')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    const linkedImg = page.locator('.mu-editor .mu-linked-drawing img')
    const inlineImg = page.locator('.mu-editor .mu-inline-drawing img')
    await expect(linkedImg).toBeVisible()
    await expect(inlineImg).toBeVisible()
    const beforeLinkedSrc = await linkedImg.getAttribute('src')

    await page.evaluate(() => {
      const editor = document.querySelector('.mu-editor')
      if (!editor) throw new Error('Missing editor root')
      const state = {
        inlineImg: editor.querySelector('.mu-inline-drawing img'),
        sawLoading: false
      }
      ;(window as unknown as Record<string, unknown>).__linkedProbe = state
      const observer = new MutationObserver(() => {
        if (editor.querySelector('.mu-image-loading')) state.sawLoading = true
      })
      observer.observe(editor, { attributes: true, childList: true, subtree: true })
      ;(window as unknown as Record<string, unknown>).__linkedObserver = observer
    })

    await linkedImg.click()
    const popup = page.getByRole('dialog', { name: 'linked.excalidraw' })
    await expect(popup.locator('canvas.interactive')).toBeVisible()
    await drawShape(page, popup, 'toolbar-rectangle')

    await expect.poll(async() => JSON.parse(await readFile(linkedPath, 'utf8')).elements.length).toBe(1)
    await expect.poll(() => linkedImg.getAttribute('src')).not.toBe(beforeLinkedSrc)

    const probe = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      ;(w.__linkedObserver as MutationObserver | undefined)?.disconnect()
      const state = w.__linkedProbe as { inlineImg: Element | null; sawLoading: boolean }
      const editor = document.querySelector('.mu-editor')
      if (!editor) throw new Error('Missing editor root')
      return {
        sawLoading: state.sawLoading,
        sameInlineImg: editor.querySelector('.mu-inline-drawing img') === state.inlineImg
      }
    })
    expect(probe).toEqual({ sawLoading: false, sameInlineImg: true })
  } finally {
    await app.close()
  }
})
