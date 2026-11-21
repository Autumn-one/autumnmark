import { expect, test } from '@playwright/test'
import type { Locator, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { clickMenuById, launchWithDoc, launchWithMarkdown, toggleReadingMode } from './helpers'

async function checkBottomEdge(block: Locator) {
  const edge = block.locator('.mu-code-edge')
  await expect(edge).toHaveCSS('background-image', /^linear-gradient\((?:to bottom, |180deg, )?rgba\(0, 0, 0, 0\), rgb\(238, 238, 238\)\)$/)
  const strip = (await edge.boundingBox())!
  const frame = (await block.boundingBox())!
  const arrow = (await edge.getByRole('button').boundingBox())!
  const code = (await block.locator('.mu-code').boundingBox())!
  expect(Math.abs(strip.width - frame.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(strip.y + strip.height - frame.y - frame.height)).toBeLessThanOrEqual(1)
  expect(strip.height).toBe(14)
  expect(Math.abs(arrow.x + arrow.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1)
  expect(arrow.y).toBeGreaterThanOrEqual(code.y + code.height - 1)
  expect((await block.locator('.mu-code-copy').boundingBox())!.y).toBeLessThan(code.y)
}

async function dragHorizontalScrollbar(page: Page, viewport: Locator) {
  const { x, y, gutter } = await viewport.evaluate(el => {
    const box = el.getBoundingClientRect()
    const gutter = box.height - el.clientHeight
    return { x: box.left + 6, y: box.bottom - gutter / 2, gutter }
  })
  expect(gutter).toBeGreaterThan(1)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 80, y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await viewport.evaluate(el => { el.scrollLeft = 0 })
}

async function checkResizeGripOnHover(block: Locator) {
  await block.locator('.mu-code').hover()
  const handle = block.locator('.mu-code-resize')
  const grip = await handle.evaluate(el => {
    const style = getComputedStyle(el, '::before')
    return { visibility: style.visibility, opacity: Number(style.opacity), width: parseFloat(style.width) }
  })
  expect(grip.visibility).toBe('visible')
  expect(grip.opacity).toBeGreaterThan(0)
  expect(grip.width).toBeGreaterThan(52)
}

test('editing code scrolls inside the preview and expands from its bottom edge', async() => {
  const source = [
    'function complete(id: number) {',
    '  const todo = todos.find(item => item.id === id)',
    '  if (!todo) return false',
    '  todo.complete()',
    '  return true',
    '}',
    '',
    'function search(keyword: string) {',
    '  const query = keyword.trim().toLowerCase()',
    '  return todos.filter(item => item.title.toLowerCase().includes(query) || item.tags.some(tag => tag.toLowerCase().includes(query)))',
    '}'
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
    await checkBottomEdge(block)
    await checkResizeGripOnHover(block)
    await block.screenshot({ path: test.info().outputPath('code-edge-collapsed.png') })
    await dragHorizontalScrollbar(page, code)
    const top = await editor.evaluate(el => el.scrollTop)
    await code.hover()
    await page.mouse.wheel(0, 160)
    await expect.poll(() => code.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await editor.evaluate(el => el.scrollTop)).toBe(top)
    await copy.click()
    await expect.poll(async() => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)
    await expand.click()
    await expect.poll(() => code.evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true)
    await checkBottomEdge(block)
    await checkResizeGripOnHover(block)
    await block.screenshot({ path: test.info().outputPath('code-edge-expanded.png') })
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
    await toggleReadingMode(page)
    await expect(editor).toHaveClass(/mu-read-only/)
    const toggle = block.getByRole('button', { name: '展开全部' })
    const copy = block.locator('.mu-code-copy')
    await expect(toggle).toBeVisible()
    await expect(block).toHaveAttribute('data-reading-language', 'TypeScript')
    await expect(block.locator('.mu-code-resize')).toBeHidden()
    await expect(editor.locator('.mu-code-block').nth(1).locator('.mu-compact-toggle')).toHaveCount(0)
    await checkBottomEdge(block)
    await expect.poll(() => viewport.evaluate(el => ({
      rows: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
      left: el.scrollLeft, top: el.scrollTop, widthFits: el.scrollWidth <= el.clientWidth + 1
    }))).toEqual({ rows: 3, left: 0, top: 0, widthFits: false })
    await dragHorizontalScrollbar(page, viewport)
    await viewport.hover()
    const before = await editor.evaluate(el => el.scrollTop)
    await page.mouse.wheel(0, 150)
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await editor.evaluate(el => el.scrollTop)).toBe(before)
    await copy.click()
    await expect.poll(async() => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(code)
    await toggle.press('Enter')
    const collapse = block.getByRole('button', { name: '收起' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { wrapCodeBlocks: true }))
    await expect(viewport).toHaveCSS('white-space', 'pre-wrap')
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
      return { x: box.x + box.width / 4, y: box.y + box.height / 2 }
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
