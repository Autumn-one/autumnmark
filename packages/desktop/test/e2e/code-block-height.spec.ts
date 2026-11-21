import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithDoc, launchWithMarkdown, toggleReadingMode } from './helpers'

test('editing code uses the top toolbar while typing, scrolling and changing language', async() => {
  const source = [
    'function complete(id: number) {',
    '  const todo = todos.find(item => item.id === id)',
    '  if (!todo) return false',
    '  todo.complete()',
    '  return true',
    '}',
    '',
    `// ${'long line '.repeat(50)}`
  ].join('\n')
  const markdown = `# Tasks\n\n~~~ts\n${source}\n~~~\n\n${'Paragraph.\n\n'.repeat(45)}`
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { compactCodeMaxLines: 6, language: 'zh-CN' }
  })
  try {
    const editor = page.locator('.editor-component')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    const block = editor.locator('.mu-code-block')
    const code = block.locator('.mu-code')
    const content = code.locator('.mu-codeblock-content')
    const expand = block.getByRole('button', { name: '展开全部' })
    const copy = block.locator('.mu-code-copy')
    await content.click({ position: { x: 5, y: 8 } })
    await expect(code).toHaveClass(/mu-active/)
    await expect(block).toHaveAttribute('data-reading-language', 'TypeScript')
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    const buttonBox = (await expand.boundingBox())!
    const copyBox = (await copy.boundingBox())!
    expect(Math.abs(buttonBox.y - copyBox.y)).toBeLessThan(4)
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(copyBox.x)
    expect(buttonBox.y + buttonBox.height).toBeLessThan((await code.boundingBox())!.y)
    await expect(code).toHaveCSS('scrollbar-width', 'none')
    expect(await block.locator('.mu-code-resize').evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0')
    await block.screenshot({ path: test.info().outputPath('editing-code-preview.png') })
    const top = await editor.evaluate(el => el.scrollTop)
    await code.hover()
    await page.mouse.wheel(0, 160)
    await expect.poll(() => editor.evaluate(el => el.scrollTop)).toBeGreaterThan(top)
    expect(await code.evaluate(el => el.scrollTop)).toBe(0)
    await copy.click()
    await expect.poll(async() => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)
    await expand.click()
    await expect.poll(() => code.evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true)
    await block.getByRole('button', { name: '收起' }).press('Enter')
    await expect(expand).toHaveAttribute('aria-expanded', 'false')

    const language = block.locator('.mu-language-input')
    await language.click()
    await expect(language).toHaveCSS('opacity', '1')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.keyboard.insertText('js')
    await content.click({ position: { x: 4, y: 6 } })
    await expect(block).toHaveAttribute('data-reading-language', 'JavaScript')
    await page.keyboard.press('Home')
    await page.keyboard.insertText('// ')
    await expect(content).toHaveJSProperty('textContent', '// ' + source)
  } finally {
    await app.close()
  }
})

test('reading code previews wrap, expand and copy the complete source', async() => {
  const code = ['function sample() {', `    const value = "${'x'.repeat(260)}"`, '    return value', '}'].join('\n')
  const markdown = `~~~ts max-lines=3\n${code}\n~~~\n\n~~~\nshort\n~~~\n\n${'Paragraph.\n\n'.repeat(60)}`
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { compactMode: false, wrapCodeBlocks: false, language: 'zh-CN' }
  })
  try {
    const editor = page.locator('.editor-component')
    const block = editor.locator('.mu-code-block').first()
    const viewport = block.locator('.mu-code')
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
    await toggleReadingMode(page)
    await expect(editor).toHaveClass(/mu-read-only/)
    const toggle = block.getByRole('button', { name: '展开全部' })
    const copy = block.locator('.mu-code-copy')
    await expect(toggle).toBeVisible()
    await expect(block).toHaveAttribute('data-reading-language', 'TypeScript')
    await expect(block.locator('.mu-code-resize')).toBeHidden()
    await expect(editor.locator('.mu-code-block').nth(1).locator('.mu-compact-toggle')).toHaveCount(0)
    const toggleBox = (await toggle.boundingBox())!
    const copyBox = (await copy.boundingBox())!
    expect(Math.abs(toggleBox.y - copyBox.y)).toBeLessThan(4)
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(copyBox.x)
    await expect.poll(() => viewport.evaluate(el => ({
      rows: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
      left: el.scrollLeft, top: el.scrollTop, widthFits: el.scrollWidth <= el.clientWidth + 1
    }))).toEqual({ rows: 3, left: 0, top: 0, widthFits: true })
    await viewport.hover()
    const before = await editor.evaluate(el => el.scrollTop)
    await page.mouse.wheel(0, 150)
    await expect.poll(() => editor.evaluate(el => el.scrollTop)).toBeGreaterThan(before)
    expect(await viewport.evaluate(el => el.scrollTop)).toBe(0)
    await copy.click()
    await expect.poll(async() => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(code)
    await toggle.press('Enter')
    const collapse = block.getByRole('button', { name: '收起' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    const wrapped = block.locator('.mu-reading-code-line').nth(1)
    expect(await wrapped.evaluate(el => {
      const style = getComputedStyle(el)
      return parseFloat(style.paddingInlineStart) > 0 && el.clientHeight > 2 * parseFloat(style.lineHeight)
    })).toBe(true)
    await collapse.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggleReadingMode(page)
    await expect(block.locator('.mu-code-resize')).toBeVisible()
    await expect(block.locator('.mu-reading-code-line')).toHaveCount(0)
    await expect(block.locator('.mu-codeblock-content')).toHaveJSProperty('textContent', code)
  } finally {
    await app.close()
  }
})

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
