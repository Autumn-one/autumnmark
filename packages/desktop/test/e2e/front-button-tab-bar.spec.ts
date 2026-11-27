import { expect, test } from '@playwright/test'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

test('block front button stays below the tab bar when a tall block top scrolls under it', async() => {
  const codeLines = Array.from({ length: 16 }, (_, i) => `const value${i} = ${i}`).join('\n')
  const tail = Array.from({ length: 24 }, (_, i) => `Trailing paragraph ${i + 1}`).join('\n\n')
  const markdown = `Intro paragraph\n\n\`\`\`js\n${codeLines}\n\`\`\`\n\n${tail}\n`

  const { app, page } = await launchWithMarkdown(markdown, {
    windowLayout: { tabBarMode: 'visible', showTabBar: true }
  })
  try {
    const tabs = page.locator('.editor-tabs')
    await expect(tabs).toBeVisible()
    const tabsBox = await tabs.boundingBox()
    const editorBox = await page.locator('.editor-component').boundingBox()
    if (!tabsBox || !editorBox) throw new Error('Expected visible tab bar and editor scrollport')

    // Scroll the code block so its top edge sits inside the tab bar's vertical band.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.editor-component')
      const code = document.querySelector<HTMLElement>('.mu-code-block')
      if (!scroller || !code) throw new Error('Missing editor elements')
      const scrollerRect = scroller.getBoundingClientRect()
      const codeRect = code.getBoundingClientRect()
      scroller.scrollTop += (codeRect.top - scrollerRect.top) + 24
    })

    const codeBlock = page.locator('.mu-code-block').first()
    const codeBox = await codeBlock.boundingBox()
    if (!codeBox) throw new Error('Expected visible code block')
    expect(codeBox.y).toBeLessThan(editorBox.y)
    expect(codeBox.y).toBeGreaterThan(tabsBox.y - 10)

    const hoverX = codeBox.x + 40
    const hoverY = editorBox.y + 40
    await page.mouse.move(hoverX, hoverY)
    await page.waitForTimeout(50)
    await page.mouse.move(hoverX + 4, hoverY)

    const frontWrapper = page.locator('.mu-front-button-wrapper')
    await expect(frontWrapper).toHaveCSS('opacity', '1')

    const buttonBox = await frontWrapper.boundingBox()
    if (!buttonBox) throw new Error('Expected visible front button')
    // Button must never overlap the tab bar or title bar.
    expect(buttonBox.y).toBeGreaterThanOrEqual(editorBox.y - 0.5)
    expect(buttonBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 0.5)
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(codeBox.y + codeBox.height + 0.5)

    // Clicking the clamped button opens the paragraph menu cleanly.
    await page.locator('.mu-front-button').click()
    await expect(page.locator('.mu-front-menu')).toBeVisible()
    await page.keyboard.press('Escape')

    // Moving the pointer over the tab bar hides the front button immediately.
    await page.mouse.move(tabsBox.x + 40, tabsBox.y + tabsBox.height / 2)
    await expect(frontWrapper).toHaveCSS('opacity', '0')

    // Opening Find and hovering over the search bar must not summon the front button.
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    const searchBar = page.locator('.search-bar')
    await expect(searchBar).toBeVisible()
    const searchBox = await searchBar.boundingBox()
    if (!searchBox) throw new Error('Expected visible search bar')
    await page.mouse.move(searchBox.x + 40, searchBox.y + searchBox.height / 2)
    await page.waitForTimeout(400)
    await expect(frontWrapper).toHaveCSS('opacity', '0')
  } finally {
    await app.close()
  }
})

test('preview toolbar stays below the tab bar when a diagram top scrolls under it', async() => {
  const tail = Array.from({ length: 24 }, (_, i) => `Trailing paragraph ${i + 1}`).join('\n\n')
  const markdown = `Intro\n\n\`\`\`mermaid\ngraph TD\n    A[Start] --> B[Middle]\n    B --> C[End]\n\`\`\`\n\n${tail}\n`

  const { app, page } = await launchWithMarkdown(markdown, {
    windowLayout: { tabBarMode: 'visible', showTabBar: true }
  })
  try {
    const tabs = page.locator('.editor-tabs')
    await expect(tabs).toBeVisible()
    await expect(page.locator('.mu-diagram-preview svg').first()).toBeVisible({ timeout: 15_000 })
    const tabsBox = await tabs.boundingBox()
    const editorBox = await page.locator('.editor-component').boundingBox()
    if (!tabsBox || !editorBox) throw new Error('Expected visible tab bar and editor scrollport')

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.editor-component')
      const diagram = document.querySelector<HTMLElement>('.mu-diagram-block')
      if (!scroller || !diagram) throw new Error('Missing diagram elements')
      const scrollerRect = scroller.getBoundingClientRect()
      const diagramRect = diagram.getBoundingClientRect()
      scroller.scrollTop += (diagramRect.top - scrollerRect.top) + 24
    })

    const diagramBox = await page.locator('.mu-diagram-block').first().boundingBox()
    if (!diagramBox) throw new Error('Expected visible diagram block')
    expect(diagramBox.y).toBeLessThan(editorBox.y)

    const hoverX = diagramBox.x + diagramBox.width / 2
    const hoverY = editorBox.y + 40
    await page.mouse.move(hoverX, hoverY)
    await page.waitForTimeout(50)
    await page.mouse.move(hoverX + 4, hoverY)

    const toolbar = page.locator('.mu-preview-tools')
    await expect.poll(async() => toolbar.evaluate((el) => {
      const wrapper = el.closest('.mu-float-wrapper') as HTMLElement | null
      return Number.parseFloat(wrapper?.style.opacity || '0')
    }), { timeout: 5_000 }).toBe(1)

    const toolbarBox = await toolbar.boundingBox()
    if (!toolbarBox) throw new Error('Expected visible preview toolbar')
    expect(toolbarBox.y).toBeGreaterThanOrEqual(editorBox.y - 0.5)
    expect(toolbarBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 0.5)
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(diagramBox.y + diagramBox.height + 0.5)

    // Moving onto the tab bar hides the preview toolbar immediately.
    await page.mouse.move(tabsBox.x + 40, tabsBox.y + tabsBox.height / 2)
    await expect.poll(async() => toolbar.evaluate((el) => {
      const wrapper = el.closest('.mu-float-wrapper') as HTMLElement | null
      return Number.parseFloat(wrapper?.style.opacity || '0')
    })).toBe(0)
  } finally {
    await app.close()
  }
})
