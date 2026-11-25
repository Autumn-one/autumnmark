import { expect, test } from '@playwright/test'
import { launchWithMarkdown } from './helpers'

test('overlong H1s stay on one line and reveal their full text on hover', async() => {
  const longText = '这段标题超出编辑器可用宽度'.repeat(12)
  const markdown = [
    `# **第一节**<br>${longText}（末尾）`,
    `下划线标题\n${longText}\n=======`,
    '正文'
  ].join('\n\n')
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { theme: 'pine-ink', followSystemTheme: false }
  })
  try {
    const atx = page.locator('h1 > .mu-atxheading-content')
    const setext = page.locator('h1 > .mu-setextheading-content')
    const tooltip = page.locator('.editor-heading-tooltip')

    for (const heading of [atx, setext]) {
      await expect(heading).toHaveCSS('text-overflow', 'ellipsis')
      expect(await heading.evaluate(el => ({
        overflowing: el.scrollWidth > el.clientWidth,
        singleLine: el.clientHeight <= Math.ceil(Number.parseFloat(getComputedStyle(el).lineHeight))
      }))).toEqual({ overflowing: true, singleLine: true })
    }
    await atx.hover()
    await expect(tooltip).toHaveText(`第一节 ${longText}（末尾）`)
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip).toBeHidden()

    await setext.hover()
    await expect(tooltip).toHaveText(`下划线标题 ${longText}`)
    await expect(tooltip).toBeVisible()
    await page.mouse.move(5, 5)
    await expect(tooltip).toBeHidden()

    await atx.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await expect.poll(() => atx.evaluate(el => {
      const caret = getSelection()?.getRangeAt(0).getBoundingClientRect()
      return !!caret && caret.x <= el.getBoundingClientRect().right + 1 && el.scrollLeft > 0
    })).toBe(true)
    await page.keyboard.insertText('已编辑')
    await expect(atx).toContainText('（末尾）已编辑')
    await page.locator('.mu-paragraph').click()
    await expect.poll(() => atx.evaluate(el => el.scrollLeft)).toBe(0)
  } finally {
    await app.close()
  }
})
