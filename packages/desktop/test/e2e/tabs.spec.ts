import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blankDrawing } from '../../src/shared/drawing'
import {
  getMarkdownContent,
  launchElectron,
  launchWithMarkdown,
  openProjectFolder,
  placeCaretInEditor,
  sendIpcToRenderer,
  typeIntoEditor
} from './helpers'

const tabSelector = '.tabs-container > li'

// Reach into the live Pinia `editor` store through the mounted Vue app. The
// renderer exposes the active pinia instance on `#app.__vue_app__` via
// `config.globalProperties.$pinia`, and pinia keeps its registered stores in
// the internal `_s` Map keyed by id. Driving `CLOSE_OTHER_TABS` /
// `CLOSE_SAVED_TABS` / `CLOSE_ALL_TABS` here runs the EXACT production action
// the tab context-menu bus events (`TABS::close-others` / `close-saved` /
// `close-all`) delegate to — the bus itself is a module-scoped mitt emitter
// not reachable from `page.evaluate`, so the store handle is the headless
// equivalent of clicking the (native, non-headless) context-menu entries.
const callEditorStoreAction = (
  page: Page,
  action: string,
  tabId?: string
): Promise<boolean> =>
  page.evaluate(
    ({ actionName, id }) => {
      const root = document.querySelector('#app') as
        | (Element & { __vue_app__?: { config?: { globalProperties?: Record<string, unknown> } } })
        | null
      const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia as
        | { _s?: Map<string, Record<string, (...args: unknown[]) => unknown>> }
        | undefined
      const store = pinia?._s?.get('editor')
      if (!store || typeof store[actionName] !== 'function') return false
      if (id) {
        const tab = (store.tabs as unknown as Array<{ id: string }>).find((t) => t.id === id)
        if (!tab) return false
        store[actionName](tab)
      } else {
        store[actionName]()
      }
      return true
    },
    { actionName: action, id: tabId }
  )

const readTabIds = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.tabs-container > li')).map(
      (li) => li.getAttribute('data-id') ?? ''
    )
  )

const activeTabId = (page: Page): Promise<string | null> =>
  page.evaluate(
    () => document.querySelector('.tabs-container > li.active')?.getAttribute('data-id') ?? null
  )

test.describe('Tab management', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Tab base\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Initial document loads as a single tab in the tab list', async() => {
    // Tab bar may be hidden by default (v-show), but the DOM still contains the list.
    await page.waitForSelector('.tabs-container', { state: 'attached', timeout: 5000 })
    const count = await page.locator(tabSelector).count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('Creating a new untitled tab grows the tab count', async() => {
    const before = await page.locator(tabSelector).count()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await page.waitForFunction(
      ({ selector, prev }) => {
        return document.querySelectorAll(selector).length > prev
      },
      { selector: tabSelector, prev: before },
      { timeout: 5000 }
    )
    const after = await page.locator(tabSelector).count()
    expect(after).toBeGreaterThan(before)
  })

  for (const closeWith of ['button', 'command'] as const) {
    test(`Closing the last tab with the ${closeWith} returns to the initial page`, async() => {
      const launched = await launchWithMarkdown('# Last tab\n', {
        windowLayout: { showTabBar: true },
        preferences: {
          language: closeWith === 'button' ? 'zh-CN' : 'en',
          theme: closeWith === 'button' ? 'light' : 'dark',
          followSystemTheme: false
        }
      })
      const lastApp = launched.app
      const lastPage = launched.page
      try {
        await expect(lastPage.locator(tabSelector)).toHaveCount(1)
        if (closeWith === 'button') {
          await lastPage.locator(`${tabSelector} .close-icon`).click()
        } else {
          await sendIpcToRenderer(lastApp, 'mt::editor-close-tab')
        }
        await expect(lastPage.locator(tabSelector)).toHaveCount(0)
        const welcome = lastPage.locator('.recent-files-projects')
        await expect(welcome.getByRole('heading', { name: '秋笺 AutumnMark' })).toBeVisible()
        const logo = welcome.locator('img')
        await expect(logo).toHaveCSS('width', '48px')
        await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
        await expect(lastPage.locator('.title-brand img')).toHaveCount(0)
        await expect(lastPage.locator('.editor-with-tabs')).toHaveCount(0)
        expect(lastApp.windows()).toHaveLength(1)

        await lastPage.reload()
        await expect(lastPage.locator('.recent-files-projects')).toBeVisible()
        await expect(lastPage.locator(tabSelector)).toHaveCount(0)

        const newFileLabel = closeWith === 'button' ? '新建文件' : 'New File'
        const newFileButton = welcome.getByRole('button', { name: newFileLabel, exact: true })
        if (closeWith === 'button') {
          await expect(newFileButton).toHaveCSS('background-color', 'rgb(101, 71, 184)')
        }
        await newFileButton.click()
        await expect(lastPage.locator(tabSelector)).toHaveCount(1)
        await expect(lastPage.locator('.recent-files-projects')).toHaveCount(0)
        await typeIntoEditor(lastPage, 'After closing the last tab')
        await expect
          .poll(async() => (await getMarkdownContent(lastPage, lastApp)).trim())
          .toBe('After closing the last tab')
      } finally {
        await lastApp.close()
      }
    })
  }

  test('Creating a new untitled tab auto-focuses the editor', async() => {
    // Drop focus first so the assertion proves the NEW tab grabbed focus rather
    // than inheriting a stale one from the previously active editor.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    const before = await page.locator(tabSelector).count()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await page.waitForFunction(
      ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
      { selector: tabSelector, prev: before },
      { timeout: 5000 }
    )

    // A freshly created untitled tab auto-focuses the WYSIWYG editor: the
    // contenteditable (`.editor-component`) becomes `document.activeElement`,
    // AND a collapsed caret lands inside it — together that's the blinking
    // cursor the user expects without having to click into the editor first.
    const isFocusedWithCaret = () => {
      const root = document.querySelector('.editor-component')
      const active = document.activeElement
      const sel = window.getSelection()
      return (
        !!root &&
        !!active &&
        (root === active || root.contains(active)) &&
        !!sel &&
        sel.rangeCount > 0 &&
        sel.isCollapsed &&
        !!sel.anchorNode &&
        root.contains(sel.anchorNode)
      )
    }
    await page.waitForFunction(isFocusedWithCaret, null, { timeout: 5000 })
    expect(await page.evaluate(isFocusedWithCaret)).toBe(true)
  })

  // Item 251 — switching between two populated tabs swaps the editor BODY, not
  // just the active-tab highlight. Proves UPDATE_CURRENT_FILE -> file-changed ->
  // setContent re-renders the document on every switch.
  test('Switching tabs swaps the editor body to match the tab', async() => {
    const before = await page.locator(tabSelector).count()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'second body\n')
    await page.waitForFunction(
      ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
      { selector: tabSelector, prev: before },
      { timeout: 5000 }
    )
    const bId = await activeTabId(page)
    expect(bId).toBeTruthy()

    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('second body')

    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('# Tab base')
    expect(await activeTabId(page)).not.toBe(bId)

    const ids = await readTabIds(page)
    const bIndex = ids.indexOf(bId as string)
    expect(bIndex).toBeGreaterThanOrEqual(0)
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', bIndex)
    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('second body')
    expect(await activeTabId(page)).toBe(bId)
  })

  // Item 262 — a blank untitled tab is NOT marked unsaved before any input
  // (the engine's lone-'\n' init json-change is guarded in
  // LISTEN_FOR_CONTENT_CHANGE), and flips to unsaved on the first real keystroke.
  test('Blank untitled tab is clean until the first keystroke', async() => {
    const before = await page.locator(tabSelector).count()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await page.waitForFunction(
      ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
      { selector: tabSelector, prev: before },
      { timeout: 5000 }
    )

    // The freshly-created active tab must stay clean: its <li> has `active` but
    // not `unsaved` (= file.isSaved is true) before any input. Poll briefly so a
    // late guarded init json-change can't race the assertion.
    const activeIsClean = () => {
      const li = document.querySelector('.tabs-container > li.active')
      return !!li && !li.classList.contains('unsaved')
    }
    await expect.poll(() => page.evaluate(activeIsClean), { timeout: 3000 }).toBe(true)
    // Hold the clean state for a moment to rule out a delayed dirty flip.
    await page.waitForTimeout(300)
    expect(await page.evaluate(activeIsClean)).toBe(true)

    await placeCaretInEditor(page)
    await typeIntoEditor(page, 'X')
    await expect
      .poll(
        () =>
          page.evaluate(
            () => !!document.querySelector('.tabs-container > li.active.unsaved')
          ),
        { timeout: 5000 }
      )
      .toBe(true)
  })

  // Item 15 — the engine undo history is per-tab (`engineHistoryByTab`),
  // restored on each `file-changed` (tab switch). After switching back to tab A,
  // one undo must revert A's OWN last edit back to A's pre-edit (on-disk)
  // baseline, never tab B's edit; B's edit must never have leaked into A; and
  // the per-tab unsaved indicator must track A's TRUE dirty state across the
  // round-trip (dirty after A's edit, clean once A is undone back to disk).
  //
  // (The recipe's optional `redo` re-apply is intentionally not asserted here:
  // driving redo through the edit-action IPC re-applies relative to the live
  // DOM caret, which a synthetic Playwright selection cannot faithfully
  // reproduce after the undo re-render — the engine's own
  // historySerialization.spec.ts already proves redo is lossless when the
  // caret is correctly seated. The mandatory per-tab undo isolation below is
  // fully and faithfully exercised.)
  test('Per-tab undo history survives a tab switch', async() => {
    const aLaunch = await launchWithMarkdown('alpha\n')
    const aApp = aLaunch.app
    const aPage = aLaunch.page
    const isDirty = () =>
      aPage.evaluate(() => !!document.querySelector('.tabs-container > li.active.unsaved'))
    try {
      // Edit A: append a sentinel so A's engine history has an undo boundary and
      // the tab is dirtied. The trailing ' end' padding guards the asserted
      // 'MARKERA' token against the occasional dropped FINAL keystroke when
      // typing into the contenteditable at delay:0.
      await placeCaretInEditor(aPage)
      await typeIntoEditor(aPage, ' MARKERA end')
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERA')
      await expect.poll(isDirty, { timeout: 5000 }).toBe(true)
      const aTabId = await activeTabId(aPage)
      expect(aTabId).toBeTruthy()

      await sendIpcToRenderer(aApp, 'mt::new-untitled-tab', true, 'bravo\n')
      await aPage.waitForFunction(
        (sel) => document.querySelectorAll(sel).length >= 2,
        tabSelector,
        { timeout: 5000 }
      )
      await aPage.waitForTimeout(250)
      await placeCaretInEditor(aPage)
      await typeIntoEditor(aPage, ' MARKERB end')
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERB')

      const ids = await readTabIds(aPage)
      const aIndex = ids.indexOf(aTabId as string)
      expect(aIndex).toBeGreaterThanOrEqual(0)
      await sendIpcToRenderer(aApp, 'mt::switch-tab-by-index', aIndex)
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERA')
      expect((await getMarkdownContent(aPage, aApp)).trim()).not.toContain('MARKERB')
      expect(await activeTabId(aPage)).toBe(aTabId)
      await expect.poll(isDirty, { timeout: 5000 }).toBe(true)

      // Undo against A's RESTORED per-tab history reverts A's own edit back to
      // the on-disk baseline 'alpha' — proving the history rode the tab switch
      // with the right tab. The keystroke run may have been recorded as one or
      // (rarely, if a render split it) a few engine undo boundaries, so undo
      // until the document settles on the baseline; each step must keep removing
      // A's text and never resurrect B's.
      await expect
        .poll(
          async() => {
            const current = (await getMarkdownContent(aPage, aApp)).trim()
            if (current === 'alpha') return current
            await sendIpcToRenderer(aApp, 'mt::editor-edit-action', 'undo')
            await aPage.waitForTimeout(300)
            return (await getMarkdownContent(aPage, aApp)).trim()
          },
          { timeout: 8000 }
        )
        .toBe('alpha')
      expect((await getMarkdownContent(aPage, aApp)).trim()).not.toContain('MARKERB')
      await expect.poll(isDirty, { timeout: 5000 }).toBe(false)
    } finally {
      await aApp.close()
    }
  })

  // Issue #3958 — switching to a tab that has overflowed off the right edge of
  // the tab bar must scroll it back into the visible viewport. Before the fix
  // the active tab is highlighted but invisible (the strip never scrolls), so
  // the user can't see which tab they're on. Runs in its own app because it
  // opens many tabs to force horizontal overflow.
  test('Switching to an overflowed tab scrolls it into view', async() => {
    const launch = await launchWithMarkdown('# overflow base\n', { windowLayout: { showTabBar: true },
      preferences: {}
    })
    const sApp = launch.app
    const sPage = launch.page
    try {
      // Open enough untitled tabs to overflow the tab strip horizontally,
      // regardless of the test window width.
      const TAB_COUNT = 25
      for (let i = 0; i < TAB_COUNT; i++) {
        const before = await sPage.locator(tabSelector).count()
        await sendIpcToRenderer(sApp, 'mt::new-untitled-tab', true, `overflow body ${i}\n`)
        await sPage.waitForFunction(
          ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
          { selector: tabSelector, prev: before },
          { timeout: 5000 }
        )
      }

      // The strip must genuinely overflow, otherwise the assertions below are
      // vacuously true.
      await expect
        .poll(
          () =>
            sPage.evaluate(() => {
              const c = document.querySelector('.scrollable-tabs') as HTMLElement | null
              return !!c && c.scrollWidth > c.clientWidth + 4
            }),
          { timeout: 5000 }
        )
        .toBe(true)

      const activeTabVisible = () =>
        sPage.evaluate(() => {
          const container = document.querySelector('.scrollable-tabs')
          const tab = document.querySelector('.tabs-container > li.active')
          if (!container || !tab) return false
          const c = container.getBoundingClientRect()
          const t = tab.getBoundingClientRect()
          return t.width > 0 && t.left >= c.left - 1 && t.right <= c.right + 1
        })

      await sendIpcToRenderer(sApp, 'mt::switch-tab-by-index', 0)
      await expect.poll(activeTabVisible, { timeout: 5000 }).toBe(true)

      // Far-right (last) tab: at scrollLeft 0 it is off the right edge — the
      // regression. Switching to it must scroll the strip so it's visible.
      const ids = await readTabIds(sPage)
      await sendIpcToRenderer(sApp, 'mt::switch-tab-by-index', ids.length - 1)
      await expect.poll(activeTabVisible, { timeout: 5000 }).toBe(true)

      await sendIpcToRenderer(sApp, 'mt::switch-tab-by-index', 0)
      await expect.poll(activeTabVisible, { timeout: 5000 }).toBe(true)
    } finally {
      await sApp.close()
    }
  })

  // Item 267 — the tab context-menu "close others / close saved / close all"
  // survivor sets. Driven through the live `editor` store actions (the bus
  // events delegate verbatim to these; the native context menu / mitt bus are
  // not headless-reachable). All tabs kept SAVED so no unsaved-close dialog
  // blocks. Runs in its own app so the close-all teardown can't disturb the
  // shared-app tests above.
  test('Context-menu close-others / close-saved / close-all survivor sets', async() => {
    const launch = await launchWithMarkdown('# keep\n')
    const cApp = launch.app
    const cPage = launch.page
    try {
      await cApp.evaluate(({ app, dialog }) => {
        let number = 0
        dialog.showSaveDialog = async() => ({ canceled: false, filePath: `${app.getPath('userData')}/saved-tab-${++number}.md` })
      })
      // Save through real IO so the main-process owner can verify the survivor set.
      const openSavedTabs = async(bodies: string[]): Promise<void> => {
        for (const body of bodies) {
          const before = await cPage.locator(tabSelector).count()
          await sendIpcToRenderer(cApp, 'mt::new-untitled-tab', true, body)
          await cPage.waitForFunction(
            ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
            { selector: tabSelector, prev: before },
            { timeout: 5000 }
          )
          await cPage.waitForTimeout(150)
        }
        await cPage.evaluate(async() => {
          const root = document.querySelector('#app') as Element & { __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { tabs: Array<{ id: string }>; UPDATE_CURRENT_FILE(file: unknown): void; FILE_SAVE(options: { waitForResult: boolean }): Promise<{ status: string }> }> } } } } }
          const editor = root.__vue_app__.config.globalProperties.$pinia._s.get('editor')!
          for (const file of [...editor.tabs]) {
            editor.UPDATE_CURRENT_FILE(file)
            const result = await editor.FILE_SAVE({ waitForResult: true })
            if (result.status !== 'saved') throw new Error('Fixture document was not saved')
          }
        })
        await expect
          .poll(
            () => cPage.evaluate(() => !!document.querySelector('.tabs-container > li.unsaved')),
            { timeout: 5000 }
          )
          .toBe(false)
      }

      await openSavedTabs(['body one\n', 'body two\n'])
      let ids = await readTabIds(cPage)
      expect(ids.length).toBeGreaterThanOrEqual(3)
      const keepId = ids[1] as string
      expect(await callEditorStoreAction(cPage, 'CLOSE_OTHER_TABS', keepId)).toBe(true)
      await expect
        .poll(() => readTabIds(cPage), { timeout: 5000 })
        .toEqual([keepId])

      await openSavedTabs(['saved A\n', 'saved B\n'])
      ids = await readTabIds(cPage)
      expect(ids.length).toBeGreaterThanOrEqual(3)
      expect(await callEditorStoreAction(cPage, 'CLOSE_SAVED_TABS')).toBe(true)
      await expect(cPage.locator(tabSelector)).toHaveCount(0)
      await expect(cPage.locator('.recent-files-projects')).toBeVisible()

      await openSavedTabs(['final A\n', 'final B\n', 'final C\n'])
      ids = await readTabIds(cPage)
      expect(ids.length).toBeGreaterThanOrEqual(3)
      expect(await callEditorStoreAction(cPage, 'CLOSE_ALL_TABS')).toBe(true)
      await expect(cPage.locator(tabSelector)).toHaveCount(0)
      await expect(cPage.locator('.recent-files-projects')).toBeVisible()
    } finally {
      await cApp.close()
    }
  })
})

test.describe('Tab hover priority and double-click close', () => {
  test('Hovering an unsaved tab or sidebar opened file prioritizes the close button and preserves dot on mouse-focus cancel', async() => {
    const launch = await launchWithMarkdown('# Unsaved hover\n', {
      windowLayout: { showSideBar: true, showTabBar: true },
      preferences: { language: 'en', autoSave: false, openedFilesInSidebar: true }
    })
    const hApp = launch.app
    const hPage = launch.page
    try {
      await placeCaretInEditor(hPage)
      await typeIntoEditor(hPage, ' dirty')
      const tab = hPage.locator('.tabs-container > li.unsaved').first()
      const openedRow = hPage.locator('.side-bar .opened-files-list > .opened-file.unsaved').first()
      await expect(tab).toBeVisible()
      await expect(openedRow).toBeVisible()

      const readTabVisuals = () =>
        hPage.evaluate(() => {
          const li = document.querySelector('.tabs-container > li.unsaved')
          const dot = li?.querySelector('.unsaved-dot')
          const btn = li?.querySelector('.close-icon')
          if (!li || !dot || !btn) return null
          return {
            dotVisibility: getComputedStyle(dot).visibility,
            closeOpacity: Number.parseFloat(getComputedStyle(btn).opacity),
            hover: li.matches(':hover'),
            focus: btn.matches(':focus'),
            focusVisible: btn.matches(':focus-visible'),
            isActiveElement: document.activeElement === btn
          }
        })

      const readSidebarVisuals = () =>
        hPage.evaluate(() => {
          const row = document.querySelector('.side-bar .opened-files-list > .opened-file.unsaved')
          const btn = row?.querySelector('.close-icon')
          if (!row || !btn) return null
          return {
            dotVisibility: getComputedStyle(row, '::before').visibility,
            closeOpacity: Number.parseFloat(getComputedStyle(btn).opacity),
            hover: row.matches(':hover'),
            focus: btn.matches(':focus'),
            focusVisible: btn.matches(':focus-visible'),
            isActiveElement: document.activeElement === btn
          }
        })

      // Move pointer into the editor so neither the tab bar nor sidebar row is hovered.
      const editorBox = await hPage.locator('.editor-component').boundingBox()
      if (!editorBox) throw new Error('Missing editor bounds')
      await hPage.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)

      await expect.poll(readTabVisuals).toMatchObject({ dotVisibility: 'visible', closeOpacity: 0, hover: false })
      await expect.poll(readSidebarVisuals).toMatchObject({ dotVisibility: 'visible', closeOpacity: 0, hover: false })

      // Hover the tab label area (left side, away from the right-aligned close button).
      const tabBox = await tab.boundingBox()
      if (!tabBox) throw new Error('Missing tab bounds')
      await hPage.mouse.move(tabBox.x + 14, tabBox.y + tabBox.height / 2)
      await expect.poll(readTabVisuals).toMatchObject({ dotVisibility: 'hidden', closeOpacity: 1, hover: true })

      // Hover the sidebar opened-file text area (right side, away from the left-aligned close button).
      const rowBox = await openedRow.boundingBox()
      if (!rowBox) throw new Error('Missing opened-file row bounds')
      await hPage.mouse.move(rowBox.x + rowBox.width - 14, rowBox.y + rowBox.height / 2)
      await expect.poll(readTabVisuals).toMatchObject({ dotVisibility: 'visible', closeOpacity: 0, hover: false })
      await expect.poll(readSidebarVisuals).toMatchObject({ dotVisibility: 'hidden', closeOpacity: 1, hover: true })

      // Move back to the editor so both return to idle state.
      await hPage.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
      await expect.poll(readSidebarVisuals).toMatchObject({ dotVisibility: 'visible', closeOpacity: 0, hover: false })

      // E4: Keyboard :focus-visible on close button shows close icon and hides the dot.
      await hPage.locator('.editor-tabs > .new-file').focus()
      await hPage.keyboard.press('Shift+Tab')
      await expect.poll(readTabVisuals).toMatchObject({
        isActiveElement: true,
        focusVisible: true,
        dotVisibility: 'hidden',
        closeOpacity: 1
      })

      // E5: Mouse-click close -> Cancel dialog -> residual :focus without :focus-visible keeps the dot visible.
      // Click the editor first so mouse interaction clears the keyboard focus-visible modality left by E4.
      await hPage.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
      await hApp.evaluate(({ dialog }) => {
        dialog.showMessageBox = async() => ({ response: 2, checkboxChecked: false })
      })
      await tab.locator('.close-icon').click()
      await hPage.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
      // Native dialog may drop webContents focus; restore mouse-modality focus on the close button if needed.
      await hPage.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('.tabs-container > li.unsaved .close-icon')
        if (btn && document.activeElement !== btn) btn.focus()
      })
      await expect.poll(readTabVisuals).toMatchObject({
        isActiveElement: true,
        focus: true,
        focusVisible: false,
        hover: false,
        dotVisibility: 'visible',
        closeOpacity: 0
      })

      // Same E5 mouse-focus residual check on sidebar opened-file row.
      await hPage.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
      await openedRow.locator('.close-icon').click()
      await hPage.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
      await hPage.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('.side-bar .opened-files-list > .opened-file.unsaved .close-icon')
        if (btn && document.activeElement !== btn) btn.focus()
      })
      await expect.poll(readSidebarVisuals).toMatchObject({
        isActiveElement: true,
        focus: true,
        focusVisible: false,
        hover: false,
        dotVisibility: 'visible',
        closeOpacity: 0
      })
    } finally {
      await hApp.close()
    }
  })

  test('Double-clicking a tab closes clean, unsaved, preview, and last tabs while guarding close button and drag gestures', async() => {
    const projectDir = mkdtempSync(join(tmpdir(), 'marktext-dblclick-tabs-'))
    const alphaPath = join(projectDir, 'alpha.md')
    const betaPath = join(projectDir, 'beta.md')
    writeFileSync(alphaPath, '# Alpha\n', 'utf-8')
    writeFileSync(betaPath, '# Beta\n', 'utf-8')
    const launched = await launchElectron([], {
      windowLayout: { showSideBar: true, showTabBar: true },
      preferences: { language: 'en', autoSave: false, openFilesInPreviewMode: true }
    })
    const dApp = launched.app
    const dPage = launched.page
    try {
      await openProjectFolder(dApp, dPage, projectDir, alphaPath)

      // Preview tab: double-clicking the tab closes it (Scheme A).
      await dPage.locator('.side-bar-file[title$="alpha.md"]').click()
      const alphaTab = dPage.locator('.tabs-container > li[title$="alpha.md"]')
      await expect(alphaTab).toHaveClass(/preview/)
      await alphaTab.dblclick()
      await expect(dPage.locator(tabSelector)).toHaveCount(0)
      await expect(dPage.locator('.recent-files-projects')).toBeVisible()

      // Re-open two pinned tabs via sidebar double-click so we can test drag suppression, unsaved prompt, and close-icon double-click.
      await dPage.locator('.side-bar-file[title$="alpha.md"]').dblclick()
      await expect(alphaTab).toBeVisible()
      await dPage.locator('.side-bar-file[title$="beta.md"]').dblclick()
      const betaTab = dPage.locator('.tabs-container > li[title$="beta.md"]')
      await expect(dPage.locator(tabSelector)).toHaveCount(2)

      // Real pointer drag >5px and return to origin within double-click window must not close the tab.
      const betaBox = await betaTab.boundingBox()
      if (!betaBox) throw new Error('Missing beta tab bounds')
      const cx = betaBox.x + 18
      const cy = betaBox.y + betaBox.height / 2
      await dPage.mouse.click(cx, cy)
      await dPage.mouse.move(cx, cy)
      await dPage.mouse.down()
      await dPage.mouse.move(cx + 24, cy, { steps: 6 })
      await dPage.mouse.move(cx, cy, { steps: 6 })
      await dPage.mouse.up()
      await dPage.waitForTimeout(100)
      await expect(dPage.locator(tabSelector)).toHaveCount(2)

      // A genuine double-click right after dragging still closes the tab.
      await dPage.mouse.dblclick(cx, cy)
      await expect(betaTab).toHaveCount(0)
      await expect(dPage.locator(tabSelector)).toHaveCount(1)

      // Double-clicking the empty tab strip area does not close the remaining tab.
      const stripBox = await dPage.locator('.editor-tabs').boundingBox()
      if (!stripBox) throw new Error('Missing tab strip bounds')
      await dPage.mouse.dblclick(stripBox.x + stripBox.width - 8, stripBox.y + stripBox.height / 2)
      await expect(dPage.locator(tabSelector)).toHaveCount(1)

      // Dirty tab: double-clicking the close button prompts once (Cancel), then double-clicking tab body prompts once (Don't Save).
      await placeCaretInEditor(dPage)
      await typeIntoEditor(dPage, ' unsaved change')
      await expect(alphaTab).toHaveClass(/unsaved/)
      await dApp.evaluate(({ dialog }) => {
        const audit = globalThis as unknown as { closePromptCount: number; closeResponse: number }
        audit.closePromptCount = 0
        audit.closeResponse = 2
        dialog.showMessageBox = async() => {
          audit.closePromptCount++
          return { response: audit.closeResponse, checkboxChecked: false }
        }
      })
      await alphaTab.locator('.close-icon').dblclick()
      await expect.poll(() => dApp.evaluate(() =>
        (globalThis as unknown as { closePromptCount: number }).closePromptCount
      )).toBe(1)
      await expect(dPage.locator(tabSelector)).toHaveCount(1)

      await dApp.evaluate(() => {
        (globalThis as unknown as { closeResponse: number }).closeResponse = 1
      })
      await alphaTab.dblclick({ position: { x: 16, y: 12 } })
      await expect.poll(() => dApp.evaluate(() =>
        (globalThis as unknown as { closePromptCount: number }).closePromptCount
      )).toBe(2)
      await expect(dPage.locator(tabSelector)).toHaveCount(0)
      await expect(dPage.locator('.recent-files-projects')).toBeVisible()
    } finally {
      await dApp.close()
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test('Double-clicking a dirty drawing tab close button triggers only one discard confirmation', async() => {
    const blankInlineDrawing = `![Embedded drawing](data:application/x-excalidraw;base64,${Buffer.from(blankDrawing).toString('base64')})`
    const launch = await launchWithMarkdown(`Before\n\n${blankInlineDrawing}\n\nAfter\n`, {
      windowLayout: { showTabBar: true },
      preferences: { language: 'en', embedDrawings: true, autoSave: false },
      suppressErrorDialog: true
    })
    const gApp = launch.app
    const gPage = launch.page
    try {
      const preview = gPage.locator('.mu-editor .mu-inline-drawing img')
      await expect(preview).toBeVisible()
      await preview.click()
      const popup = gPage.getByRole('dialog', { name: 'Embedded drawing' })
      await expect(popup).toBeVisible()
      await popup.getByRole('button', { name: 'Open in Tab' }).click()
      await expect(popup).toBeHidden()

      const drawingTab = gPage.locator('.tabs-container > li.active')
      await expect(drawingTab).toHaveText('Embedded drawing.excalidraw')
      const workspace = gPage.locator('.drawing-workspace:visible')
      await expect(workspace.locator('.excalidraw canvas').first()).toBeVisible()
      await workspace.getByRole('tab', { name: 'Source' }).click()
      await workspace.getByRole('textbox', { name: 'Excalidraw JSON' }).fill('{')

      // Two rapid close-button clicks before the modal backdrop mounts: WindowSession._close's
      // _closing single-flight lock must drop the second close so only one confirmation opens.
      await gPage.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('.tabs-container > li.active .close-icon')
        if (!btn) throw new Error('Missing drawing tab close button')
        btn.click()
        btn.click()
        btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 }))
      })
      const confirmBox = gPage.locator('.el-message-box:visible')
      await expect(confirmBox).toHaveCount(1)
      await confirmBox.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmBox).toHaveCount(0)
      // Hold briefly to verify no queued second confirmation reappears from the second click.
      await gPage.waitForTimeout(150)
      await expect(confirmBox).toHaveCount(0)
      await expect(drawingTab).toHaveCount(1)

      // Double-click tab title: prompts once and discarding closes the drawing tab.
      await drawingTab.dblclick({ position: { x: 24, y: 12 } })
      await expect(confirmBox).toHaveCount(1)
      await confirmBox.getByRole('button', { name: 'Discard Changes' }).click()
      await expect(confirmBox).toHaveCount(0)
      await expect(gPage.locator(tabSelector)).toHaveCount(1)
      await expect(gPage.locator('.drawing-workspace')).toHaveCount(0)
    } finally {
      await gApp.close()
    }
  })

  test('Overflow tab double-click closes the clicked clipped tab, defers single-click scroll, and ignores cross-tab mismatches', async() => {
    const launch = await launchWithMarkdown('# overflow dblclick\n', {
      windowLayout: { showTabBar: true },
      preferences: { language: 'en', autoSave: false }
    })
    const oApp = launch.app
    const oPage = launch.page
    try {
      for (let i = 0; i < 25; i++) {
        const before = await oPage.locator(tabSelector).count()
        await sendIpcToRenderer(oApp, 'mt::new-untitled-tab', true, '')
        await oPage.waitForFunction(
          ({ selector, prev }) => document.querySelectorAll(selector).length > prev,
          { selector: tabSelector, prev: before },
          { timeout: 5000 }
        )
      }

      // Switch to tab 0 so the strip scrolls to the left edge and tabs overflow off the right.
      await sendIpcToRenderer(oApp, 'mt::switch-tab-by-index', 0)
      await expect.poll(() =>
        oPage.evaluate(() => {
          const c = document.querySelector('.scrollable-tabs') as HTMLElement | null
          return !!c && c.scrollWidth > c.clientWidth + 4 && c.scrollLeft === 0
        })
      ).toBe(true)

      const findClippedRightTab = () =>
        oPage.evaluate(() => {
          const container = document.querySelector('.scrollable-tabs')
          const items = Array.from(document.querySelectorAll<HTMLElement>('.tabs-container > li'))
          if (!container) return null
          const cRect = container.getBoundingClientRect()
          for (let i = 0; i < items.length - 1; i++) {
            const rect = items[i].getBoundingClientRect()
            const visibleWidth = Math.min(rect.right, cRect.right) - Math.max(rect.left, cRect.left)
            if (rect.left >= cRect.left && rect.left < cRect.right - 12 && rect.right > cRect.right + 4 && visibleWidth >= 14) {
              return {
                id: items[i].getAttribute('data-id') ?? '',
                neighborId: items[i + 1].getAttribute('data-id') ?? '',
                clickX: rect.left + Math.min(visibleWidth / 2, 12),
                clickY: rect.top + rect.height / 2
              }
            }
          }
          return null
        })

      // Ensure a clipped tab exists at the right viewport boundary (adjust scrollLeft slightly if an exact boundary aligns).
      let clipped = await findClippedRightTab()
      if (!clipped) {
        await oPage.evaluate(() => {
          const container = document.querySelector('.scrollable-tabs') as HTMLElement | null
          if (container) container.scrollLeft = 24
        })
        clipped = await findClippedRightTab()
      }
      if (!clipped) throw new Error('Could not find a partially clipped tab on the right edge')

      // E15 positive: double-clicking the clipped tab closes that exact tab and keeps its neighbor open.
      await oPage.mouse.dblclick(clipped.clickX, clipped.clickY)
      await expect.poll(async() => readTabIds(oPage)).not.toContain(clipped.id)
      expect(await readTabIds(oPage)).toContain(clipped.neighborId)

      // E15 single-click deferred scroll: click a partially clipped tab and verify it scrolls into view after 500ms.
      await sendIpcToRenderer(oApp, 'mt::switch-tab-by-index', 0)
      await oPage.evaluate(() => {
        const container = document.querySelector('.scrollable-tabs') as HTMLElement | null
        if (container) container.scrollLeft = 24
      })
      const clippedForSingle = await findClippedRightTab()
      if (!clippedForSingle) throw new Error('Could not find clipped tab for single-click scroll check')
      await oPage.mouse.click(clippedForSingle.clickX, clippedForSingle.clickY)
      expect(await activeTabId(oPage)).toBe(clippedForSingle.id)
      // Within the 500ms window, the tab must still be clipped (strip has not jumped under the pointer).
      await oPage.waitForTimeout(150)
      const stillClipped = await oPage.evaluate((id) => {
        const container = document.querySelector('.scrollable-tabs')
        const tab = document.querySelector(`.tabs-container > li[data-id="${id}"]`)
        if (!container || !tab) return false
        return tab.getBoundingClientRect().right > container.getBoundingClientRect().right + 1
      }, clippedForSingle.id)
      expect(stillClipped).toBe(true)
      // After 500ms, the clicked tab scrolls fully into view.
      await expect.poll(
        () =>
          oPage.evaluate((id) => {
            const container = document.querySelector('.scrollable-tabs')
            const tab = document.querySelector(`.tabs-container > li[data-id="${id}"]`)
            if (!container || !tab) return false
            const c = container.getBoundingClientRect()
            const t = tab.getBoundingClientRect()
            return t.left >= c.left - 1 && t.right <= c.right + 1
          }, clippedForSingle.id),
        { timeout: 2000 }
      ).toBe(true)

      // E15 negative: click tab A then shift tab B under the exact same pointer before click #2 (genuine detail=2 + dblclick on B).
      // B must become active and neither A nor B may be closed.
      await sendIpcToRenderer(oApp, 'mt::switch-tab-by-index', 0)
      const shiftPair = await oPage.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('.tabs-container > li'))
        if (items.length < 3) return null
        const first = items[1]
        const second = items[2]
        const r1 = first.getBoundingClientRect()
        const r2 = second.getBoundingClientRect()
        return {
          firstId: first.getAttribute('data-id') ?? '',
          secondId: second.getAttribute('data-id') ?? '',
          clickX: r1.left + 16,
          clickY: r1.top + r1.height / 2,
          deltaX: r2.left - r1.left
        }
      })
      if (!shiftPair) throw new Error('Missing adjacent tabs for mismatch check')
      await oPage.evaluate((secondId) => {
        const tracker = { secondClickDetail: 0, secondDblClick: false }
        ;(globalThis as unknown as { __mismatchTracker?: typeof tracker }).__mismatchTracker = tracker
        const secondEl = document.querySelector(`.tabs-container > li[data-id="${secondId}"]`)
        secondEl?.addEventListener('click', (event) => {
          tracker.secondClickDetail = (event as MouseEvent).detail
        }, { capture: true })
        secondEl?.addEventListener('dblclick', () => {
          tracker.secondDblClick = true
        }, { capture: true })
      }, shiftPair.secondId)
      await oPage.mouse.click(shiftPair.clickX, shiftPair.clickY)
      await oPage.evaluate((dx) => {
        const container = document.querySelector('.scrollable-tabs') as HTMLElement | null
        if (container) container.scrollLeft += dx
      }, shiftPair.deltaX)
      // Dispatch the second click of the double-click gesture (clickCount: 2) onto the shifted neighbor tab.
      await oPage.mouse.move(shiftPair.clickX, shiftPair.clickY)
      await oPage.mouse.down({ clickCount: 2 })
      await oPage.mouse.up({ clickCount: 2 })
      await oPage.waitForTimeout(150)
      const tracker = await oPage.evaluate(() =>
        (globalThis as unknown as { __mismatchTracker?: { secondClickDetail: number; secondDblClick: boolean } }).__mismatchTracker
      )
      expect(tracker?.secondClickDetail).toBe(2)
      expect(tracker?.secondDblClick).toBe(true)
      expect(await activeTabId(oPage)).toBe(shiftPair.secondId)
      const remaining = await readTabIds(oPage)
      expect(remaining).toContain(shiftPair.firstId)
      expect(remaining).toContain(shiftPair.secondId)
    } finally {
      await oApp.close()
    }
  })
})
