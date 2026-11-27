import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { clickMenuById, launchElectron, openProjectFolder, sendIpcToRenderer } from './helpers'

const expectTabBar = async(app: ElectronApplication, page: Page, visible: boolean) => {
  await expect(page.locator('.editor-tabs')).toBeVisible({ visible })
  await expect.poll(() => app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById('tabBarMenuItem')?.checked
  )).toBe(visible)
}

const openFile = async(app: ElectronApplication, pathname: string) => {
  await app.evaluate(({ BrowserWindow, ipcMain }, target) => {
    const win = BrowserWindow.getAllWindows()[0]
    ipcMain.emit('app-open-file-by-id', win.id, target)
  }, pathname)
}

test.describe('Issue #5581 tab bar visibility', () => {
  let app: ElectronApplication
  let page: Page
  let directory: string

  test.beforeEach(async() => {
    directory = mkdtempSync(path.join(tmpdir(), 'marktext-5581-'))
    for (const filename of ['first.md', 'second.md']) {
      writeFileSync(path.join(directory, filename), `# ${filename}\n`)
    }
    const launched = await launchElectron([path.join(directory, 'first.md')], { windowLayout: { showTabBar: true },
      preferences: {
        language: 'en',
        restoreLayoutState: true,
        openFilesInNewWindow: false,
        openFilesInPreviewMode: false
      }
    })
    app = launched.app
    page = launched.page
    await expect(page.locator('.tabs-container > li')).toHaveCount(1)
  })

  test.afterEach(async() => {
    if (app) await app.close()
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  for (const remaining of [0, 1]) {
    test(`hidden tab bar stays hidden after closing to ${remaining} files and reopening`, async() => {
      const tabs = page.locator('.tabs-container > li')
      await openFile(app, path.join(directory, 'second.md'))
      await expect(tabs).toHaveCount(2)
      await clickMenuById(app, 'tabBarMenuItem')
      await expectTabBar(app, page, false)

      for (let count = 2; count > remaining; count--) {
        await sendIpcToRenderer(app, 'mt::editor-close-tab')
        await expect(tabs).toHaveCount(count - 1)
      }
      if (remaining === 0) await expect(page.locator('.recent-files-projects')).toBeVisible()
      await expectTabBar(app, page, false)

      await openFile(app, path.join(directory, 'first.md'))
      await expect(tabs).toHaveCount(1)
      await openFile(app, path.join(directory, 'second.md'))
      await expect(tabs).toHaveCount(2)
      await expectTabBar(app, page, false)

      await clickMenuById(app, 'tabBarMenuItem')
      await expectTabBar(app, page, true)
    })
  }

  test('hiding in multi-file mode stays hidden across new tabs and opening folders', async() => {
    await openFile(app, path.join(directory, 'second.md'))
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await clickMenuById(app, 'tabBarMenuItem')
    await expectTabBar(app, page, false)

    await app.evaluate(({ Menu, BrowserWindow }) => {
      const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
      const newTab = fileMenu?.submenu?.items.find(item => item.label === 'New Tab')
      if (!newTab) throw new Error('New Tab menu item is missing')
      const win = BrowserWindow.getAllWindows()[0]
      newTab.click(undefined, win, win.webContents)
    })
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
    await expectTabBar(app, page, false)

    await openProjectFolder(app, page, directory, path.join(directory, 'first.md'))
    await expectTabBar(app, page, false)

    await clickMenuById(app, 'tabBarMenuItem')
    await expectTabBar(app, page, true)
    await openFile(app, path.join(directory, 'second.md'))
    await expectTabBar(app, page, true)
  })

  test('hiding a visible tab bar on a single file returns to auto mode', async() => {
    await expectTabBar(app, page, true)
    await clickMenuById(app, 'tabBarMenuItem')
    await expectTabBar(app, page, false)

    await app.evaluate(({ Menu, BrowserWindow }) => {
      const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
      const newTab = fileMenu?.submenu?.items.find(item => item.label === 'New Tab')
      if (!newTab) throw new Error('New Tab menu item is missing')
      const win = BrowserWindow.getAllWindows()[0]
      newTab.click(undefined, win, win.webContents)
    })
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await expectTabBar(app, page, true)
  })
})

test.describe('Multi-file tab bar auto-show', () => {
  let app: ElectronApplication | undefined
  let directory: string
  let userDataDir: string

  const readPersistedWindow = (dataDir: string) => {
    try {
      const snapshot = JSON.parse(
        readFileSync(path.join(dataDir, 'state', 'application-state.json'), 'utf8')
      )
      const win = snapshot.session?.windows?.[0]
      return { count: win?.documents?.length, tabBar: win?.layout?.tabBar }
    } catch {
      return null
    }
  }

  test.beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'marktext-tabbar-autoshow-'))
    userDataDir = mkdtempSync(path.join(tmpdir(), 'marktext-tabbar-autoshow-data-'))
    for (const filename of ['first.md', 'second.md', 'third.md']) {
      writeFileSync(path.join(directory, filename), `# ${filename}\n`)
    }
    writeFileSync(
      path.join(directory, 'sketch.excalidraw'),
      JSON.stringify({ type: 'excalidraw', version: 2, source: 'autumnmark', elements: [], appState: {}, files: {} })
    )
  })

  test.afterEach(async() => {
    if (app) {
      await app.close()
      app = undefined
    }
    rmSync(directory, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  test('auto-shows for multiple files, auto-hides back to one, persists manual hide, and exits back to auto', async() => {
    const launched = await launchElectron([path.join(directory, 'first.md')], {
      userDataDir,
      preferences: {
        language: 'en',
        restoreEditors: true,
        restoreLayoutState: true,
        openFilesInNewWindow: false,
        openFilesInPreviewMode: false
      }
    })
    app = launched.app
    const page = launched.page
    const tabs = page.locator('.tabs-container > li')

    await expect(tabs).toHaveCount(1)
    await expectTabBar(app, page, false)

    await openFile(app, path.join(directory, 'second.md'))
    await expect(tabs).toHaveCount(2)
    await expectTabBar(app, page, true)

    // Closing back to a single file auto-hides the tab bar in auto mode.
    await sendIpcToRenderer(app, 'mt::editor-close-tab')
    await expect(tabs).toHaveCount(1)
    await expectTabBar(app, page, false)

    // Reopening a second file auto-shows again; manually hiding locks hidden.
    await openFile(app, path.join(directory, 'second.md'))
    await expect(tabs).toHaveCount(2)
    await expectTabBar(app, page, true)

    await clickMenuById(app, 'tabBarMenuItem')
    await expectTabBar(app, page, false)

    await openFile(app, path.join(directory, 'third.md'))
    await expect(tabs).toHaveCount(3)
    await expectTabBar(app, page, false)

    await expect.poll(() => readPersistedWindow(userDataDir)).toEqual({
      count: 3,
      tabBar: { visible: false, mode: 'hidden' }
    })

    await app.close()
    app = undefined

    const restarted = await launchElectron([], { userDataDir })
    app = restarted.app
    const restartedTabs = restarted.page.locator('.tabs-container > li')
    await expect(restartedTabs).toHaveCount(3)
    await expectTabBar(restarted.app, restarted.page, false)

    // Showing again while multi-file returns to auto, so closing back to one file auto-hides.
    await clickMenuById(restarted.app, 'tabBarMenuItem')
    await expectTabBar(restarted.app, restarted.page, true)
    await sendIpcToRenderer(restarted.app, 'mt::editor-close-tab')
    await expect(restartedTabs).toHaveCount(2)
    await sendIpcToRenderer(restarted.app, 'mt::editor-close-tab')
    await expect(restartedTabs).toHaveCount(1)
    await expectTabBar(restarted.app, restarted.page, false)
  })

  test('single-file visible lock persists, avoids tabs-visible titlebar on zero tabs, and migrates legacy visible state', async() => {
    const launched = await launchElectron([path.join(directory, 'first.md')], {
      userDataDir,
      preferences: {
        language: 'en',
        restoreEditors: true,
        restoreLayoutState: true,
        openFilesInNewWindow: false,
        openFilesInPreviewMode: false
      }
    })
    app = launched.app
    const page = launched.page

    await expectTabBar(app, page, false)
    await clickMenuById(app, 'tabBarMenuItem')
    await expectTabBar(app, page, true)
    await expect(page.locator('.title-bar-editor-bg')).toHaveClass(/tabs-visible/)

    // Closing the last tab hides the editor and clears the title bar tabs-visible class.
    await sendIpcToRenderer(app, 'mt::editor-close-tab')
    await expect(page.locator('.recent-files-projects')).toBeVisible()
    await expect(page.locator('.editor-tabs')).toHaveCount(0)
    await expect(page.locator('.title-bar-editor-bg')).not.toHaveClass(/tabs-visible/)

    await openFile(app, path.join(directory, 'first.md'))
    await expectTabBar(app, page, true)
    await expect.poll(() => readPersistedWindow(userDataDir)).toEqual({
      count: 1,
      tabBar: { visible: true, mode: 'visible' }
    })

    await app.close()
    app = undefined

    const restarted = await launchElectron([], { userDataDir })
    app = restarted.app
    await expect(restarted.page.locator('.tabs-container > li')).toHaveCount(1)
    await expectTabBar(restarted.app, restarted.page, true)

    // Simulate legacy state ({ visible: true } without mode) and verify migration to auto.
    await app.close()
    app = undefined
    const statePath = path.join(userDataDir, 'state', 'application-state.json')
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    raw.session.windows[0].layout.tabBar = { visible: true }
    writeFileSync(statePath, JSON.stringify(raw))

    const migrated = await launchElectron([], { userDataDir })
    app = migrated.app
    await expect(migrated.page.locator('.tabs-container > li')).toHaveCount(1)
    await expectTabBar(migrated.app, migrated.page, false)
    await openFile(migrated.app, path.join(directory, 'second.md'))
    await expect(migrated.page.locator('.tabs-container > li')).toHaveCount(2)
    await expectTabBar(migrated.app, migrated.page, true)
  })

  test('auto-shows when launching directly with multiple files or a single drawing file', async() => {
    const launched = await launchElectron(
      [path.join(directory, 'first.md'), path.join(directory, 'second.md')],
      {
        userDataDir,
        preferences: {
          language: 'en',
          openFilesInNewWindow: false
        }
      }
    )
    app = launched.app
    await expect(launched.page.locator('.tabs-container > li')).toHaveCount(2)
    await expectTabBar(launched.app, launched.page, true)
    await app.close()
    app = undefined

    const drawingDataDir = mkdtempSync(path.join(tmpdir(), 'marktext-tabbar-drawing-'))
    try {
      const drawing = await launchElectron([path.join(directory, 'sketch.excalidraw')], {
        userDataDir: drawingDataDir,
        preferences: { language: 'en' }
      })
      app = drawing.app
      await expect(drawing.page.locator('.tabs-container > li')).toHaveCount(1)
      await expectTabBar(drawing.app, drawing.page, true)
    } finally {
      if (app) {
        await app.close()
        app = undefined
      }
      rmSync(drawingDataDir, { recursive: true, force: true })
    }
  })
})
