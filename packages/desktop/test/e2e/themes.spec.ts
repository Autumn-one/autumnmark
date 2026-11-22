import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById, setSourceMarkdown } from './helpers'

test('default light theme styles prose and keeps the table and code typography', async() => {
  const markdown = [
    '# Title', '## Section', 'Some **emphasis**', '> Quote', '- [x] Task',
    '| Column |\n| --- |\n| **Cell** |', '```js\nconst n = 1\n```'
  ].join('\n\n')
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { followSystemTheme: false }
  })
  try {
    const editor = page.locator('.mu-container')
    await expect(editor.locator('h1')).toHaveCSS('text-align', 'center')
    await expect(editor.locator('h2')).toHaveCSS('background-color', 'rgb(17, 151, 125)')
    await expect(editor.locator('h2')).toHaveCSS('padding-left', '10px')
    await expect(editor.locator('.mu-paragraph strong')).toHaveCSS('color', 'rgb(17, 151, 125)')
    await expect(editor.locator('blockquote')).toHaveCSS('background-color', 'rgb(245, 247, 249)')
    await expect(editor.locator('td strong')).toHaveCSS('color', 'rgb(77, 77, 77)')
    await expect(editor.locator('td strong')).toHaveCSS('font-family', /Open Sans/)
    await expect(editor.locator('.mu-code-block')).toHaveCSS('font-family', /DejaVu Sans Mono/)
    await expect.poll(() => editor.locator('.mu-checkbox-checked').evaluate(
      el => getComputedStyle(el, '::before').backgroundColor
    )).toBe('rgb(21, 172, 142)')
    await clickMenuById(app, 'graphite')
    await expect(editor.locator('h1')).not.toHaveCSS('text-align', 'center')
  } finally {
    await app.close()
  }
})

test.describe('Theme switching', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Theme test\n\nHello theme world.\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Switch to a dark theme adds body.dark', async() => {
    await clickMenuById(app, 'dracula')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
  })

  test('Switch to a light theme removes body.dark', async() => {
    await clickMenuById(app, 'light')
    await page.waitForFunction(() => !document.body.classList.contains('dark'), null, {
      timeout: 5000
    })
    expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(false)
  })

  test('Switch back to dark theme re-applies body.dark', async() => {
    await clickMenuById(app, 'nord')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
  })

  // Item 282 — Prism code-block syntax highlighting token colors follow the
  // active theme. The @muyajs/core engine runs prism.highlightElement over the
  // code block content (codeBlockContent/index.ts), emitting standard Prism
  // token classes (span.token.keyword, span.token.number, …). Each theme ships
  // a matching Prism CSS (assets/themes/prismjs/<theme>.theme.css) that colors
  // those tokens. We assert the keyword token color is themed (non-default) and
  // differs between a dark theme (dracula) and the light baseline. Real pixel
  // fidelity stays manual; this just proves the wiring is live and theme-aware.
  test('Prism code-block token color follows the active theme', async() => {
    await setSourceMarkdown(page, app, '```js\nconst answer = 42\n```\n')

    // The language grammar loads asynchronously, so the token spans only
    // appear once prism.highlightElement has run. Poll until a keyword token
    // (rendered for `const`) shows up inside the editor's code block.
    await page.waitForFunction(
      () => !!document.querySelector('.editor-component span.token.keyword'),
      null,
      { timeout: 15000 }
    )

    const readKeywordColor = async(): Promise<string> => {
      return await page.evaluate(() => {
        const el = document.querySelector(
          '.editor-component span.token.keyword'
        ) as HTMLElement | null
        return el ? getComputedStyle(el).color : ''
      })
    }

    await clickMenuById(app, 'dracula')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
    let darkColor = ''
    await expect
      .poll(
        async() => {
          darkColor = await readKeywordColor()
          return darkColor
        },
        { timeout: 10000 }
      )
      .not.toBe('rgb(0, 0, 0)')
    expect(darkColor).not.toBe('')

    await clickMenuById(app, 'light')
    await page.waitForFunction(() => !document.body.classList.contains('dark'), null, {
      timeout: 5000
    })
    let lightColor = ''
    await expect
      .poll(
        async() => {
          lightColor = await readKeywordColor()
          return lightColor
        },
        { timeout: 10000 }
      )
      .not.toBe('rgb(0, 0, 0)')
    expect(lightColor).not.toBe('')

    expect(lightColor).not.toBe(darkColor)
  })
})
