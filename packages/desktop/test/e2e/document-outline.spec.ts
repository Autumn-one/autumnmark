import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById, waitForEditor } from './helpers'

const markdown = Array.from({ length: 45 }, (_, i) =>
  `# Section ${i + 1}\n\n${('Body text for this section.\n\n').repeat(12)}`
).join('\n')

let app: ElectronApplication
let page: Page
const resize = async(width: number): Promise<void> => {
  const win = await app.browserWindow(page)
  await win.evaluate((window, value) => window.setContentSize(value, 800), width)
}

test.beforeAll(async() => {
  const launched = await launchWithMarkdown(markdown, { windowLayout: { showSideBar: true, showTabBar: true },
    preferences: { language: 'en',}
  })
  app = launched.app
  page = launched.page
  await waitForEditor(page)
  await resize(1600)
})
test.afterAll(async() => { await app?.close() })

test('defaults to files and switches to the outline without moving the editor', async() => {
  const outline = page.getByRole('tab', { name: 'Outline' })
  const files = page.getByRole('tab', { name: 'Files' })
  await expect(files).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.outline-toggle')).toHaveCount(0)
  const body = page.locator('.document-body')
  const before = await body.boundingBox()
  await outline.click()
  await expect(outline).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
  await expect(page.locator('#sidebar-panel-files')).toBeHidden()
  expect(await body.boundingBox()).toEqual(before)
})

test('switching files refreshes the outline without replacing the file tree', async() => {
  const win = await app.browserWindow(page)
  await win.evaluate(window => window.webContents.send('mt::new-untitled-tab', true, '# Another document\n\n## Details\n'))
  await expect(page.locator('.side-bar-toc .el-tree-node__label')).toHaveText(['Another document', 'Details'])
  await page.locator('.side-bar-toc .el-tree-node__label').filter({ hasText: /^Details$/ }).click()
  await expect(page.locator('.side-bar-toc .is-current > .el-tree-node__content')).toContainText('Details')
  await page.locator('.side-bar-toc .el-tree-node__expand-icon').first().click()
  await expect(page.locator('.side-bar-toc .is-current > .el-tree-node__content')).toContainText('Another document')
  const parent = page.locator('.side-bar-toc .el-tree > .el-tree-node').first()
  await expect(parent).toHaveAttribute('aria-expanded', 'false')
  await expect(parent.locator(':scope > .el-tree-node__children')).toBeHidden()
  await parent.locator(':scope > .el-tree-node__content .el-tree-node__expand-icon').click()
  await expect(parent).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.side-bar-toc .is-current > .el-tree-node__content')).toContainText('Details')
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
  await expect(page.locator('.side-bar')).toBeVisible()
  await page.locator('.editor-tabs li').filter({ hasText: 'note.md' }).click()
  await expect(page.locator('.side-bar-toc .el-tree-node__label')).toHaveCount(45)
})

test('adding and removing the first heading preserves the pane and its empty state', async() => {
  const win = await app.browserWindow(page)
  await win.evaluate(window => window.webContents.send('mt::new-untitled-tab', true, 'Plain paragraph'))
  const outline = page.locator('#sidebar-panel-outline')
  await expect(outline).toBeVisible()
  await expect(page.locator('.outline-empty')).toContainText('No headings')
  await expect(page.locator('.outline-bulk-toggle')).toBeHidden()
  const column = page.locator('.mu-container')
  const geometry = () => column.evaluate(el => {
    const { x, width } = el.getBoundingClientRect()
    return { x, width }
  })
  const before = await geometry()
  await page.locator('.mu-editor').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('# First heading')
  await expect(outline).toBeVisible()
  await expect(page.locator('.outline-empty')).toBeHidden()
  expect(await geometry()).toEqual(before)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(outline).toBeVisible()
  await expect(page.locator('.outline-empty')).toBeVisible()
  expect(await geometry()).toEqual(before)
  await page.locator('.editor-tabs li').filter({ hasText: 'note.md' }).click()
  await expect(outline).toBeVisible()
})

test('the view menu shows the outline from a closed sidebar and toggles back to files', async() => {
  await clickMenuById(app, 'sideBarMenuItem')
  await expect(page.locator('.side-bar')).toBeHidden()
  await clickMenuById(app, 'tocMenuItem')
  await expect(page.getByRole('tab', { name: 'Outline', selected: true })).toBeVisible()
  const menuChecked = () => app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById('tocMenuItem')?.checked
  )
  await expect.poll(menuChecked).toBe(true)

  const editor = page.locator('.document-body')
  const before = await editor.boundingBox()
  await clickMenuById(app, 'tocMenuItem')
  await expect(page.getByRole('tab', { name: 'Files', selected: true })).toBeVisible()
  expect(await editor.boundingBox()).toEqual(before)
  await expect.poll(menuChecked).toBe(false)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await expect.poll(async() => {
    const state = JSON.parse(await readFile(join(userData, 'state', 'application-state.json'), 'utf8'))
    return state.session.windows[0].layout.sidebar.activeView
  }).toBe('files')
  await clickMenuById(app, 'tocMenuItem')
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
})

test('clicking a lower outline entry preserves its scroll position throughout the jump', async() => {
  const tree = page.locator('.side-bar-toc .el-tree')
  const label = tree.locator('.el-tree-node__label').filter({ hasText: /^Section 38$/ })
  await label.scrollIntoViewIfNeeded()
  const before = await tree.evaluate(el => {
    const positions: number[] = []
    el.addEventListener('scroll', () => positions.push(el.scrollTop))
    ;(el as HTMLElement & { positions: number[] }).positions = positions
    return el.scrollTop
  })
  await label.click()
  await expect.poll(() => page.locator('.mu-editor').evaluate(el => {
    const heading = Array.from(el.querySelectorAll('.mu-container > h1')).find(node => node.textContent?.includes('Section 38'))
    if (!heading) return Infinity
    return Math.abs(heading.getBoundingClientRect().top - el.getBoundingClientRect().top - 24)
  })).toBeLessThan(2)
  const positions = await tree.evaluate(el => [el.scrollTop, ...(el as HTMLElement & { positions: number[] }).positions])
  expect(positions.every(top => Math.abs(top - before) < 2)).toBe(true)
})

test('scrolling the document highlights and reveals an offscreen outline entry', async() => {
  await page.locator('.mu-editor').dispatchEvent('wheel')
  await page.locator('.mu-editor').evaluate(el => {
    const target = Array.from(el.querySelectorAll('.mu-container > h1')).find(node => node.textContent?.includes('Section 20'))
    if (!target) throw new Error('Missing rendered heading')
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 30
  })
  const current = page.locator('.side-bar-toc .is-current > .el-tree-node__content .el-tree-node__label')
  await expect(current).toHaveText('Section 20')
  await expect.poll(() => page.locator('.side-bar-toc .el-tree').evaluate(tree => {
    const current = tree.querySelector('.is-current > .el-tree-node__content')
    if (!current) return false
    const row = current.getBoundingClientRect()
    const viewport = tree.getBoundingClientRect()
    return row.top >= viewport.top && row.bottom <= viewport.bottom && tree.scrollTop > 0
  })).toBe(true)
})

test('source mode scroll also updates the outline', async() => {
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await expect(page.locator('.source-code')).toBeVisible()
  await page.locator('.source-code').evaluate(el => {
    const heading = Array.from(el.querySelectorAll('.CodeMirror-line')).find(line => line.textContent === '# Section 30')
    if (!heading) throw new Error('Missing source heading')
    el.scrollTop += heading.getBoundingClientRect().top - el.getBoundingClientRect().top - 30
  })
  await expect(page.locator('.side-bar-toc .is-current > .el-tree-node__content')).toContainText('Section 30')
})
