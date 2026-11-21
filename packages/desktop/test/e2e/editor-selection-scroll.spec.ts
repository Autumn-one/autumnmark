import { expect, test, type Locator } from '@playwright/test'
import { launchWithMarkdown } from './helpers'

const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n')
const code = Array.from({ length: 150 }, (_, i) => `const value${i} = ${i}`).join('\n')

const scrollTopAfterLayout = (element: Locator) => element.evaluate(async el => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  return el.scrollTop
})

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
