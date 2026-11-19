import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, expectNoRendererErrors, launchElectron, sendIpcToRenderer, showOutline, toggleReadingMode, waitForEditor } from './helpers'
import type { ApplicationState } from '../../src/shared/types/applicationState'

let directory: string
let documentPath: string
let app: ElectronApplication
let page: Page
const row = (pathname: string) => page.locator(`[data-tree-path=${JSON.stringify(pathname)}]`)
const tab = (pathname: string) => page.locator('.tabs-container').getByTitle(pathname, { exact: true })
const command = () => sendIpcToRenderer(app, 'mt::execute-command-by-id', 'file.open-containing-folder')

const openFromTabMenu = async(pathname: string): Promise<void> => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('mt::menu::popup')
    ipcMain.on('mt::menu::popup', (event, template: Array<{ id?: string; enabled?: boolean }>) => {
      const item = template.find(item => item.id?.startsWith('openContainingFolder-'))
      if (item?.enabled) event.sender.send('mt::menu::click', { id: item.id })
    })
  })
  await tab(pathname).click({ button: 'right' })
}

test.beforeEach(async() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-containing-folder-')))
  const folder = path.join(directory, 'project', '笔记 with spaces')
  fs.mkdirSync(folder, { recursive: true })
  documentPath = path.join(folder, 'z-current.md')
  fs.writeFileSync(documentPath, '# Current\n\nOriginal text\n')
  for (let index = 0; index < 40; index++) {
    fs.writeFileSync(path.join(folder, `sibling-${index}.md`), '# Sibling\n')
  }
  const launched = await launchElectron([documentPath], {
    windowLayout: { showSideBar: false, showTabBar: true },
    suppressErrorDialog: true,
    preferences: {
      language: 'en',
      autoRevealInSidebar: false,
      autoSave: false,
      openFolderInNewWindow: true,
      openFilesInPreviewMode: false
    }
  })
  app = launched.app
  page = launched.page
  await waitForEditor(page)
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async() => { throw new Error('Unexpected folder picker') }
  })
})

test.afterEach(async() => {
  if (app) {
    try {
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  }
  fs.rmSync(directory, { recursive: true, force: true })
})

test('adds a standalone file folder, reveals it and persists it without losing edits', async() => {
  await expect(page.locator('.project-root')).toHaveCount(0)
  const editor = page.getByRole('textbox', { name: 'Document', exact: true })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Unsaved6073')
  await openFromTabMenu(documentPath)

  await expect(page.locator('.side-bar')).toBeVisible()
  await expect(page.locator('.project-root')).toHaveCount(1)
  await expect(row(documentPath)).toHaveClass(/active/)
  await expect(row(documentPath)).toBeInViewport()
  await expect(page.locator('.side-bar-file')).toHaveCount(41)
  await expect(editor).toContainText('Unsaved6073')
  expect(fs.readFileSync(documentPath, 'utf8')).not.toContain('Unsaved6073')
  expect(app.windows()).toHaveLength(1)

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await expect.poll(() => {
    const filename = path.join(userData, 'state', 'application-state.json')
    if (!fs.existsSync(filename)) return []
    const state = JSON.parse(fs.readFileSync(filename, 'utf8')) as ApplicationState
    return state.session.windows[0].workspace?.roots.map(root => root.location.path)
  }).toEqual([path.dirname(documentPath)])

  await page.locator('.project-root').click()
  await expect(page.locator('.project-root')).toHaveAttribute('aria-expanded', 'false')
  await sendIpcToRenderer(app, 'mt::show-command-palette')
  await page.locator('input.search:visible').first().fill('Open Containing Folder')
  await page.locator('.commands li').filter({ hasText: 'Open Containing Folder in Side Bar' }).click()
  await expect(row(documentPath)).toBeInViewport()
  await command()
  await expect(page.locator('.project-root')).toHaveCount(1)
  await expect(row(documentPath)).toHaveClass(/active/)
})

test('reuses an ancestor root and keeps unrelated roots when invoked on a background tab', async() => {
  const other = fs.mkdtempSync(path.join(directory, 'other-'))
  const otherFile = path.join(other, 'other.md')
  fs.writeFileSync(otherFile, '# Other\n')
  await app.evaluate(({ ipcMain, BrowserWindow }, roots) => {
    const win = BrowserWindow.getAllWindows()[0]
    for (const root of roots) ipcMain.emit('app-add-directory-by-id', win.id, root)
  }, [path.dirname(path.dirname(documentPath)), other])
  await expect(page.locator('.project-root')).toHaveCount(2)
  await expect(page.locator('.root-status')).toHaveCount(0)
  await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, {}), otherFile)
  await expect(page.locator('.tabs-container > li.active')).toHaveAttribute('title', otherFile)
  await row(path.dirname(path.dirname(documentPath))).click()
  await openFromTabMenu(documentPath)
  await expect(row(documentPath)).toBeInViewport()
  await expect(row(documentPath)).toHaveClass(/active/)
  await expect(page.locator('.tabs-container > li.active')).toHaveAttribute('title', otherFile)
  await expect(page.locator('.project-root')).toHaveCount(2)
  await expect(page.locator('.el-notification')).toHaveCount(0)
})

test('appends file locations to the editor menu on blank lines, line ends and margins', async() => {
  await app.evaluate(({ ipcMain, Menu, BrowserWindow }) => {
    const state = { items: [] as string[], count: 0, selected: '', revealedPath: '' }
    Object.assign(globalThis, { folderMenuState: state })
    ipcMain.removeAllListeners('mt::shell::show-item')
    ipcMain.on('mt::shell::show-item', (_event, pathname: string) => { state.revealedPath = pathname })
    Menu.prototype.popup = function(options) {
      state.count++
      state.items = this.items.map(item => item.type === 'separator' ? 'separator' : item.id?.replace(/-mi-\d+$/, '') || item.label)
      const selected = this.items.find(item => state.selected && item.enabled && item.label === state.selected)
      if (selected) selected.click(undefined, BrowserWindow.getAllWindows()[0], undefined)
      options?.callback?.()
    }
  })
  const menuState = () => app.evaluate(() => (globalThis as typeof globalThis & {
    folderMenuState: { items: string[]; count: number; revealedPath: string }
  }).folderMenuState)
  const selectItem = (id: string) => app.evaluate((_electron, id) => {
    Object.assign((globalThis as typeof globalThis & { folderMenuState: object }).folderMenuState, { selected: id })
  }, id)
  const locationItems = ['separator', 'Show in folder', 'Open Containing Folder in Side Bar']
  const editorItems = [
    'insertParagraphBeforeMenuItem', 'insertParagraphAfterMenuItem', 'separator',
    'cutMenuItem', 'copyMenuItem', 'pasteMenuItem', 'separator',
    'copyAsRichMenuItem', 'copyAsHtmlMenuItem', 'pasteAsPlainTextMenuItem'
  ]
  const menuSuffix = [...editorItems, ...locationItems]
  await selectItem('Show in folder')
  await page.locator('.mu-editor').click({ button: 'right', position: { x: 8, y: 8 } })
  await expect.poll(async() => (await menuState()).items.slice(-menuSuffix.length)).toEqual(menuSuffix)
  await expect.poll(async() => (await menuState()).revealedPath).toBe(documentPath)
  await selectItem('')
  const paragraph = page.locator('.mu-paragraph').last()
  const end = await paragraph.evaluate(element => ({ x: element.clientWidth - 12, y: Math.floor(element.clientHeight / 2) }))
  await paragraph.click({ button: 'right', position: end })
  await expect.poll(async() => (await menuState()).count).toBe(2)
  expect((await menuState()).items.slice(-menuSuffix.length)).toEqual(menuSuffix)
  await paragraph.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.locator('.mu-paragraph').last().click({ button: 'right', position: { x: 3, y: 4 } })
  await expect.poll(async() => (await menuState()).count).toBe(3)
  expect((await menuState()).items.slice(-menuSuffix.length)).toEqual(menuSuffix)

  const textPoint = await page.getByText('Original text', { exact: true }).first().evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getClientRects()[0]
    return { x: rect.left + 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(textPoint.x, textPoint.y, { button: 'right' })
  await expect.poll(async() => (await menuState()).count).toBe(4)
  expect((await menuState()).items.slice(-editorItems.length)).toEqual(editorItems)

  await toggleReadingMode(page)
  await page.locator('.mu-read-only').click({ button: 'right', position: { x: 8, y: 8 } })
  await expect.poll(async() => (await menuState()).items.slice(-4)).toEqual(['Select All', ...locationItems])
  expect((await menuState()).items).not.toContain('pasteMenuItem')
  await toggleReadingMode(page)

  await showOutline(app, page)
  await enterSourceMode(page, app)
  const sourceItems = ['Cut', 'Copy', 'Paste', ...locationItems]
  const sourceLine = page.locator('.CodeMirror-code pre.CodeMirror-line').first()
  const sourceEnd = await sourceLine.evaluate(line => ({ x: line.clientWidth - 12, y: Math.floor(line.clientHeight / 2) }))
  await sourceLine.click({ button: 'right', position: sourceEnd })
  await expect.poll(async() => (await menuState()).items).toEqual(sourceItems)
  await selectItem('Open Containing Folder in Side Bar')
  await page.locator('.source-code').click({ button: 'right', position: { x: 8, y: 8 } })
  await expect.poll(async() => (await menuState()).items).toEqual(sourceItems)
  await expect(page.getByRole('tab', { name: 'Files', selected: true })).toBeVisible()
  await expect(row(documentPath)).toBeInViewport()

  const tree = page.locator('.tree-wrapper')
  const scrollTop = await tree.evaluate(element => {
    element.scrollTop = 250
    return element.scrollTop
  })
  expect(scrollTop).toBeGreaterThan(0)
  await page.getByRole('tab', { name: 'Outline' }).click()
  await page.getByRole('tab', { name: 'Files' }).click()
  await expect(page.locator('.project-root')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => tree.evaluate(element => element.scrollTop)).toBe(scrollTop)
})

test('reuses a containing ancestor opened through a directory alias', async() => {
  const alias = path.join(directory, 'alias')
  fs.symlinkSync(path.dirname(path.dirname(documentPath)), alias, process.platform === 'win32' ? 'junction' : 'dir')
  await app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    ipcMain.emit('app-add-directory-by-id', BrowserWindow.getAllWindows()[0].id, root)
  }, alias)
  await expect(page.locator('.root-status')).toHaveCount(0)
  await command()
  const aliasPath = path.join(alias, path.basename(path.dirname(documentPath)), path.basename(documentPath))
  await expect(row(aliasPath)).toHaveClass(/active/)
  await expect(row(aliasPath)).toBeInViewport()
  await expect(page.locator('.project-root')).toHaveCount(1)
})

test('ignores unknown document IDs and reports unavailable folders', async() => {
  const result = await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::project-open-containing-folder', 'unknown'))
  expect(result).toBeNull()
  await expect(page.locator('.project-root')).toHaveCount(0)
  fs.rmSync(path.dirname(documentPath), { recursive: true, force: true })
  await command()
  await expect(page.locator('.el-notification').filter({ hasText: 'Open Containing Folder in Side Bar' })).toBeVisible()
  await expect(page.locator('.project-root')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Document', exact: true })).toContainText('Original text')
})
