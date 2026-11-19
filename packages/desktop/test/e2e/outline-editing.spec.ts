import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { clickMenuById, enterSourceMode, expectNoRendererErrors, focusEditor, getMarkdownContent, launchWithMarkdown, showOutline } from './helpers'

const first = '## 第一节\n\n正文\n\n### 子标题\n\n```md\n# 示例\n```'
const second = '## 第二节\n\n收尾'
const original = '前言\n\n' + first + '\n\n' + second + '\n'
const moved = '前言\n\n' + second + '\n\n' + first + '\n'

for (const mode of ['rendered', 'source']) {
  test(mode + ' outline drag moves the whole section as one undo step', async() => {
    const { app, page } = await launchWithMarkdown(original, { suppressErrorDialog: true })
    try {
      if (mode === 'source') await enterSourceMode(page, app)
      await showOutline(app, page)
      const labels = page.locator('.side-bar-toc [data-toc-key]')
      const start = labels.filter({ hasText: '第一节' })
      const target = labels.filter({ hasText: '第二节' })
      await start.dragTo(target, { targetPosition: { x: 10, y: 15 } })
      await expect(labels.first()).toHaveText('第二节')
      expect((await getMarkdownContent(page, app)).trimEnd()).toBe(moved.trimEnd())
      await clickMenuById(app, 'undoMenuItem')
      await expect(labels.first()).toHaveText('第一节')
      expect((await getMarkdownContent(page, app)).trimEnd()).toBe(original.trimEnd())
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('link command preserves the label and selects the second matching Chinese heading', async() => {
  const filler = '段落正文\n\n'.repeat(35)
  const { app, page } = await launchWithMarkdown('跳转说明\n\n## 安装\n\n' + filler + '## 安装\n\n' + filler, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    await clickMenuById(app, 'hyperlinkMenuItem')
    await page.keyboard.insertText('#安装')
    const options = page.locator('.heading-link-picker [role="option"]')
    await expect(options).toHaveCount(2)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.locator('.heading-link-picker')).toHaveCount(0)
    expect(await getMarkdownContent(page, app)).toContain('[跳转说明](#安装-1)')
    await page.locator('span.mu-link').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    await expect.poll(() => page.locator('.mu-container > h2').nth(1).evaluate(heading => {
      const top = heading.closest('.editor-component')?.getBoundingClientRect().top ?? 0
      return Math.abs(heading.getBoundingClientRect().top - top - 24)
    })).toBeLessThan(4)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('source link completion reads headings from a sibling file', async() => {
  const { app, page, filePath } = await launchWithMarkdown('参考\n', { suppressErrorDialog: true })
  try {
    writeFileSync(path.join(path.dirname(filePath), 'guide.md'), '# Guide\n\nSetup\n-----\n\n```\n# Fake\n```')
    await enterSourceMode(page, app)
    await page.locator('.CodeMirror-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('[阅读](guide.md#Set')
    const option = page.locator('.heading-link-picker [role="option"]')
    await expect(option).toHaveCount(1)
    await option.click()
    expect(await getMarkdownContent(page, app)).toContain('[阅读](guide.md#setup)')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
