import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, sendIpcToRenderer, waitForEditor, waitForMenuReady } from './helpers'

// #5467: the unsaved dot belongs on the left of the breadcrumb, where it sat
// until #5317. #5317 wrapped the breadcrumb in `<bdi dir="ltr">` to stop the
// Bidi algorithm reordering numeric path segments, and the dot — which had been
// riding the `direction: rtl` clip box as a trailing neutral, hence rendering
// leftmost — went along into the isolate and landed right of the filename.
//
// The assertions below pin both halves at once: the dot on the left, never
// clipped by an over-long path, and the segments still in path order.

const FILENAME = 'the-document-name.md'
const roots: string[] = []

test.afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
})

const openIn = async(
  folders: string[],
  width = 1280,
  filename = FILENAME
): Promise<{ app: ElectronApplication; page: Page }> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2etest-5467-'))
  roots.push(root)
  const dir = path.join(root, ...folders)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, 'Alpha\n', 'utf8')

  const { app, page } = await launchElectron([filePath], {
    preferences: { autoSave: false, language: 'en', titleBarStyle: 'custom' }
  })
  await waitForEditor(page)
  await waitForMenuReady(app)
  await page.setViewportSize({ width, height: 600 })
  await expect(page.locator('.title-bar .filename').first()).toHaveText(filename)
  return { app, page }
}

const markDirty = async(page: Page): Promise<void> => {
  await page
    .locator('.mu-paragraph-content')
    .filter({ hasText: 'Alpha' })
    .first()
    .click({ timeout: 5000 })
  await page.keyboard.insertText('x')
  await expect(page.locator('.title-bar .title .save-dot')).toHaveClass(/show/)
}

const boxOf = async(page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  return box
}

const setCursorPosition = async(app: ElectronApplication, position: { x: number; y: number }) => {
  // Playwright's page mouse does not move Electron's native cursor.
  await app.evaluate(({ BrowserWindow, screen }, { x, y }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const bounds = win.getContentBounds()
    const zoom = win.webContents.getZoomFactor()
    win.isFocused = () => true
    screen.getCursorScreenPoint = () => ({ x: bounds.x + x * zoom, y: bounds.y + y * zoom })
  }, position)
}

test('keeps the unsaved dot left of the title bar path', async() => {
  const { app, page } = await openIn(['a', 'b', 'notes'])
  try {
    await markDirty(page)

    const dot = await boxOf(page, '.title-bar .title .save-dot')
    const filename = await boxOf(page, '.title-bar .title .filename')
    const firstSegment = await boxOf(page, '.title-bar .title bdi > span >> nth=0')

    await expect(page.locator('.title-bar .path')).not.toHaveClass(/\bpath-overflowing\b/)
    expect(dot.width).toBeGreaterThan(0)
    expect(dot.x + dot.width).toBeLessThanOrEqual(firstSegment.x)
    expect(dot.x + dot.width).toBeLessThanOrEqual(filename.x)
  } finally {
    await app.close()
  }
})

test('scrolls a long path and keeps the dot visible when hovering over its tail', async() => {
  const { app, page } = await openIn(
    ['aVeryLongFolderNameIndeed', 'anotherExtremelyLongFolderName', 'yetAnotherRatherLongFolderName'],
    1020
  )
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await setCursorPosition(app, { x: -25, y: -25 })
    const breadcrumb = page.locator('.title-bar .path')
    const content = breadcrumb.locator('.path-content')
    await expect(page.locator('.title-bar')).toHaveCSS('-webkit-app-region', 'drag')
    await expect(breadcrumb).not.toHaveCSS('-webkit-app-region', 'no-drag')
    await expect(content).toHaveCSS('animation-iteration-count', 'infinite')
    const initialTransform = await content.evaluate((element) => getComputedStyle(element).transform)
    await expect(content).not.toHaveCSS('transform', initialTransform)
    const loop = await content.evaluate(element => {
      const animation = element.getAnimations()[0]
      const duration = Number(animation.effect?.getTiming().duration)
      const [first, copy] = element.children
      animation.pause()
      animation.currentTime = duration - 1
      const before = copy.getBoundingClientRect().left
      animation.currentTime = duration + 1
      const after = first.getBoundingClientRect().left
      animation.play()
      return Math.abs(before - after)
    })
    expect(loop).toBeLessThan(1)


    await markDirty(page)
    // Geometry checks must be independent of which window owns desktop focus.
    await sendIpcToRenderer(app, 'mt::window-active-status', { status: true })
    const pathBox = await boxOf(page, '.title-bar .path')
    await setCursorPosition(app, {
      x: pathBox.x + pathBox.width / 2,
      y: pathBox.y + pathBox.height / 2
    })
    await expect(content).toHaveCSS('animation-name', 'none')
    const marker = breadcrumb.locator('.path-omission')
    await expect(marker).toBeVisible()
    await expect(marker).toHaveText('…')

    await expect(page.locator('.title-bar .save-dot')).toBeVisible()
    const clip = await boxOf(page, '.title-bar .path-viewport')
    const dot = await boxOf(page, '.title-bar .title .save-dot')
    const filename = await boxOf(page, '.title-bar .path-tail-file')

    expect(dot.width).toBeGreaterThan(0)
    expect(dot.x + dot.width).toBeLessThanOrEqual(clip.x)
    expect(filename.x).toBeGreaterThanOrEqual(clip.x)
    for (const segment of await breadcrumb.locator('.path-tail .path-segment').all()) {
      const box = await segment.boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(clip.x)
      expect(box && box.x + box.width).toBeLessThanOrEqual(filename.x + 0.5)
    }
    expect(filename.x + filename.width).toBeCloseTo(clip.x + clip.width, 1)

    await setCursorPosition(app, { x: -25, y: -25 })
    await expect(content).toHaveCSS('animation-iteration-count', 'infinite')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(content).toHaveCSS('animation-name', 'none')
    await expect(marker).toBeVisible()
  } finally {
    await app.close()
  }
})

test('truncates an oversized filename with a single native leading ellipsis', async() => {
  const filename = '工作记录和每周总结'.repeat(10) + '.md'
  const { app, page } = await openIn(['notes'], 940, filename)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const tail = page.locator('.title-bar .path-tail-file')
    await expect(tail).toBeVisible()
    await expect(tail).toHaveCSS('text-overflow', 'ellipsis')
    await expect(tail).toHaveCSS('direction', 'rtl')
    await expect(tail).toContainText(filename)
    expect(await tail.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect(page.locator('.path-omission')).toBeHidden()
  } finally {
    await app.close()
  }
})

test('renders numeric path segments in path order (#5317)', async() => {
  const { app, page } = await openIn(['2024', '09', '18'])
  try {
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('.title-bar .title bdi > span')]
        .filter((el) => !el.classList.contains('filename') && !el.classList.contains('save-dot'))
        .map((el) => ({ text: (el.textContent ?? '').trim(), x: el.getBoundingClientRect().left }))
        .sort((a, b) => a.x - b.x)
        .map((s) => s.text)
    )

    expect(order).toEqual(['2024', '09', '18'])
  } finally {
    await app.close()
  }
})
