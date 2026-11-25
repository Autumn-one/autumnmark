import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type CodeMirror from 'codemirror'
import { clickMenuById, enterSourceMode, launchWithMarkdown, sendIpcToRenderer, showOutline } from './helpers'

const MARKDOWN = Array.from({ length: 12 }, (_, index) =>
  `# Section ${index + 1}\n\n${'Wrapped paragraph text for testing layout changes. '.repeat(30)}\n\n`
).join('')
let app: ElectronApplication
let page: Page

test.beforeEach(async() => {
  ;({ app, page } = await launchWithMarkdown(MARKDOWN, { windowLayout: { showSideBar: true },
    preferences: { language: 'en', editorLineWidth: '100%' }
  }))
  const win = await app.browserWindow(page)
  await win.evaluate(window => window.setContentSize(1280, 800))
  await sendIpcToRenderer(app, 'mt::set-view-layout', { sideBarWidth: 280 })
  await showOutline(app, page)
})
test.afterEach(async() => { await app?.close() })

test('a narrow window keeps the editor at its minimum width beside the outline', async() => {
  const win = await app.browserWindow(page)
  await win.evaluate(window => window.setContentSize(550, 800))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(560)
  await expect.poll(() => page.locator('.document-body').evaluate(el => el.clientWidth)).toBeGreaterThanOrEqual(320)
  const contentWidth = await page.locator('.mu-container').evaluate(el => {
    const style = getComputedStyle(el)
    return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  })
  expect(contentWidth).toBeGreaterThan(100)
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible()

  await enterSourceMode(page, app)
  await expect.poll(() => page.locator('.source-code').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320)
  await win.evaluate(window => window.setContentSize(1280, 800))
  await expect.poll(() => page.locator('.side-bar').evaluate(el => el.clientWidth)).toBe(280)
  await expect.poll(() => page.locator('.editor-with-tabs > .container').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
})

const headingMeasurement = () => page.evaluate(() => {
  const wrapper = document.querySelector('.source-code .CodeMirror') as HTMLElement & { CodeMirror: CodeMirror.Editor }
  const target = Array.from(wrapper.querySelectorAll('.CodeMirror-line')).find(el => el.textContent === '# Section 8')
  if (!target) throw new Error('Missing source heading')
  const expectedLine = wrapper.CodeMirror.getValue().split('\n').indexOf('# Section 8')
  const actualLine = wrapper.CodeMirror.lineAtHeight(target.getBoundingClientRect().top + 1, 'window')
  return { expectedLine, actualLine }
})
const expectAccurateHeading = async(): Promise<void> => {
  await expect.poll(headingMeasurement).toEqual({ expectedLine: 28, actualLine: 28 })
  await page.evaluate(() => {
    const container = document.querySelector('.source-code') as HTMLElement
    const target = Array.from(container.querySelectorAll('.CodeMirror-line')).find(el => el.textContent === '# Section 8')
    if (!target) throw new Error('Missing source heading')
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 30
  })
  await page.locator('.source-code').dispatchEvent('scroll')
  await expect(page.locator('.side-bar-toc .is-current > .el-tree-node__content .el-tree-node__label')).toHaveText('Section 8')
}

test('source heading measurements follow sidebar dragging without a window resize', async() => {
  await enterSourceMode(page, app)
  await expectAccurateHeading()
  const separator = page.getByRole('separator', { name: 'Resize sidebar' })
  const bounds = await separator.boundingBox()
  if (!bounds) throw new Error('Missing sidebar divider')
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 300, y, { steps: 10 })
  await page.mouse.up()
  await expectAccurateHeading()
})

test('source heading measurements follow sidebar toggles without remounting', async() => {
  await enterSourceMode(page, app)
  await expectAccurateHeading()
  await clickMenuById(app, 'sideBarMenuItem')
  await expect(page.locator('.side-bar')).toBeHidden()
  await expect.poll(headingMeasurement).toEqual({ expectedLine: 28, actualLine: 28 })
  await clickMenuById(app, 'sideBarMenuItem')
  await expectAccurateHeading()
})
