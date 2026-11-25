import { expect, test, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown } from './helpers'

const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n')
const code = Array.from({ length: 150 }, (_, i) => `const value${i} = ${i}`).join('\n')

const scrollTopAfterLayout = (element: Locator) => element.evaluate(async el => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  return el.scrollTop
})

for (const axis of ['column', 'row'] as const) {
  test(`resizing a ${axis} in the last table keeps the viewport and the opening caret`, async() => {
    const layout = '<!-- table-layout: col-widths="1:95,2:81" row-min-heights="1:148,2:76" -->'
    const { app, page, filePath } = await launchWithMarkdown(`# Start\n\n${paragraphs}\n\n${layout}\n\n| | |\n| --- | --- |\n| | |\n`)
    try {
      const editor = page.locator('.editor-component')
      const title = editor.locator('h1')
      const caretInTitle = () => title.evaluate(el => el.contains(window.getSelection()?.focusNode ?? null))
      await expect.poll(caretInTitle).toBe(true)
      const cell = editor.locator('.mu-table-inner td').first()
      await cell.evaluate(el => el.scrollIntoView({ block: 'center' }))
      const before = await scrollTopAfterLayout(editor)
      expect(before).toBeGreaterThan(100)
      const box = await cell.boundingBox()
      if (!box) throw new Error('Missing header cell')
      const column = axis === 'column'
      const x = box.x + (column ? box.width - 2 : box.width / 2)
      const y = box.y + (column ? box.height / 2 : box.height - 2)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + (column ? 12 : 0), y + (column ? 0 : 12), { steps: 4 })
      await page.mouse.up()
      expect(await scrollTopAfterLayout(editor)).toBe(before)
      expect(await caretInTitle()).toBe(true)
      await clickMenuById(app, 'fileSaveMenuItem')
      const expectedSize = column ? 'col-widths="1:107,2:69"' : 'row-min-heights="1:160,2:64"'
      await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(expectedSize)
      await page.keyboard.press('ArrowRight')
      await expect(title).toBeInViewport()
    } finally {
      await app.close()
    }
  })
}

test('pasting long code in an empty capped block keeps the code and caret visible', async() => {
  const { app, page } = await launchWithMarkdown(`Heading\n\n~~~js\n~~~\n\n${paragraphs}`)
  try {
    const editor = page.locator('.editor-component')
    const viewport = editor.locator('.mu-code')
    const content = viewport.locator('.mu-codeblock-content')
    await content.click()
    const before = await scrollTopAfterLayout(editor)
    await content.evaluate((el, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    }, code)
    await expect(content).toHaveJSProperty('textContent', code)
    await expect(viewport).toHaveClass(/mu-compact-limited/)
    expect(await scrollTopAfterLayout(editor)).toBe(before)
    expect(await viewport.evaluate(el => {
      const selection = window.getSelection()
      if (!selection?.rangeCount) return false
      const caret = selection.getRangeAt(0)
      const rect = caret.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return caret.collapsed && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
    })).toBe(true)
    await page.keyboard.insertText(';')
    await expect(content).toHaveJSProperty('textContent', code + ';')
  } finally {
    await app.close()
  }
})

test('selecting a code block and escalating from a paragraph to the document preserve scroll', async() => {
  const { app, page } = await launchWithMarkdown(`Heading\n\n~~~\n${code}\n~~~\n\n${paragraphs}`)
  try {
    const editor = page.locator('.editor-component')
    const viewport = editor.locator('.mu-code')
    await expect(viewport).toHaveClass(/mu-compact-limited/)
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
    await viewport.click({ position: { x: 20, y: 30 } })
    const codeTop = await scrollTopAfterLayout(viewport)
    const beforeCode = await scrollTopAfterLayout(editor)
    const editorWindow = await app.browserWindow(page)
    const selectAll = () => editorWindow.evaluate((win, modifiers) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers })
    }, [process.platform === 'darwin' ? 'meta' : 'control'])
    const selected = () => page.evaluate(() => window.getSelection()?.toString())
    await selectAll()
    await expect.poll(selected).toBe(code)
    expect(await scrollTopAfterLayout(editor)).toBe(beforeCode)
    expect(await scrollTopAfterLayout(viewport)).toBe(codeTop)

    const paragraph = editor.getByText('Paragraph 40.', { exact: true })
    await paragraph.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await paragraph.click()
    const beforeParagraph = await scrollTopAfterLayout(editor)
    await selectAll()
    await expect.poll(selected).toBe('Paragraph 40.')
    expect(await scrollTopAfterLayout(editor)).toBe(beforeParagraph)
    await selectAll()
    await expect.poll(selected).toMatch(/^Heading[\s\S]*Paragraph 80\./)
    expect(await scrollTopAfterLayout(editor)).toBe(beforeParagraph)
  } finally {
    await app.close()
  }
})
