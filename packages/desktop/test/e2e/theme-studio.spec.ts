import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { clickMenuById, launchWithMarkdown } from './helpers'

async function openSettings(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
  const settings = await opened
  await settings.getByRole('button', { name: 'Theme', exact: true }).click()
  return settings
}

async function openStudio(app: ElectronApplication, settings: Page, edit = false): Promise<Page> {
  const opened = app.waitForEvent('window')
  await settings.getByRole('button', { name: edit ? 'Edit current theme' : 'Create from current theme' }).click()
  const studio = await opened
  await expect(studio.locator('.theme-studio')).toBeVisible()
  return studio
}

const layout = ':root .mu-container h2:is(.mu-atx-heading, .mu-setext-heading) { margin-top: 47px; }'
const paragraph = '.mu-container p.mu-paragraph { padding-inline: 18px; }'
const streamEdit = (replace: string) => 'data: ' + JSON.stringify({
  choices: [{ delta: { content: JSON.stringify({ find: '', replace }) + '\n' } }]
}) + '\n\n'

test('the Theme menu opens the current theme with a visible editor and rendered preview', async() => {
  const { app, page } = await launchWithMarkdown('Document', { preferences: {
    language: 'zh-CN', theme: 'nord', followSystemTheme: false
  } })
  try {
    const menuItems = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('themeMenu')?.submenu?.items.map(({ id, label }) => ({ id, label }))
    )
    expect(menuItems?.[0]).toEqual({ id: 'openThemeSettings', label: '主题设置…' })
    expect(menuItems).toContainEqual({ id: 'createThemeFromCurrent', label: '基于当前主题创建' })
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const win = await app.browserWindow(studio)
    await expect.poll(() => win.evaluate(window => window.isVisible())).toBe(true)
    const toolbar = studio.locator('.theme-studio header')
    const base = toolbar.getByRole('combobox')
    const documentMode = toolbar.getByRole('button', { name: '正文', exact: true })
    const sourceMode = toolbar.getByRole('button', { name: 'Markdown 源码', exact: true })
    const preview = studio.frameLocator('iframe')
    const previewModes = toolbar.getByRole('group', { name: '主题预览', exact: true })
    await expect(base).toHaveValue('nord')
    for (const control of [documentMode, sourceMode]) await expect(control).toBeVisible()
    await expect(studio.getByRole('button', { name: '预览本地 Markdown', exact: true })).toHaveCount(0)
    await expect(studio.locator('input[type=file][accept*=".markdown"]')).toHaveCount(0)
    const horizontalCenter = (control: Locator) => control.evaluate(element => {
      const { x, width } = element.getBoundingClientRect()
      return x + width / 2
    })
    for (const width of [1160, 700]) {
      await win.evaluate((window, width) => window.setSize(width, 700), width)
      await expect.poll(async() => Math.abs(await horizontalCenter(toolbar) - await horizontalCenter(previewModes))).toBeLessThan(2)
    }
    await expect(preview.locator('h1')).toContainText('雾岭手记')
    await expect(preview.locator('h6')).toContainText('记录约定')
    await expect(preview.locator('.mu-table-row')).toHaveCount(4)
    await expect(preview.locator('.mu-task-list-item')).toHaveCount(3)
    await expect(preview.locator('.mu-github-alert')).toHaveCount(5)
    await expect(preview.locator('.mu-math-block')).toHaveCount(1)
    await expect(preview.locator('.mu-footnote')).toHaveCount(1)
    await expect(preview.locator('strong em, em strong')).toHaveText('尤其湿滑')
    await expect(preview.getByAltText('三处站点之间的路线草图')).toHaveJSProperty('naturalWidth', 192)
    await expect(preview.locator('main')).not.toContainText('base64,')
    await sourceMode.click()
    await expect(preview.locator('.CodeMirror-line').first()).toContainText('# 雾岭手记')
    await documentMode.click()
    await expect(preview.locator('h1')).toContainText('雾岭手记')
    await (await app.browserWindow(page)).evaluate(window => window.focus())
    await clickMenuById(app, 'createThemeFromCurrent')
    expect(app.windows().filter(window => window.url().includes('theme-studio.html'))).toHaveLength(1)
  } finally { await app.close() }
})

test('the CSS inspector docks beside the studio and selects live preview HTML', async() => {
  const { app, page } = await launchWithMarkdown('## Editor document', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings)
    const native = await app.browserWindow(studio)
    await studio.getByRole('button', { name: 'CSS source' }).click()
    const input = studio.getByRole('textbox', { name: 'CSS source' })
    await input.focus()
    await studio.keyboard.insertText(layout)
    const width = await studio.evaluate(() => innerWidth)
    const inspector = studio.getByRole('button', { name: 'Inspect element', exact: true })
    await inspector.click()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => studio.evaluate(() => innerWidth)).toBeLessThan(width)
    const panels = await studio.locator('main > section').evaluateAll(items =>
      items.map(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })))
    expect(panels[1].top).toBeGreaterThanOrEqual(panels[0].bottom - 1)
    const preview = studio.frameLocator('iframe')
    await preview.locator('h2.mu-atx-heading').click({ position: { x: 2, y: 2 } })

    // DevTools exposes the selected HTML row through the accessible tree inside its shadow roots.
    function selectedTreeRows(): string[] {
      const rows: string[] = []
      function visit(root: Document | ShadowRoot): void {
        for (const item of root.querySelectorAll('[role="treeitem"][aria-selected="true"]')) {
          rows.push(item.textContent ?? '')
        }
        for (const item of root.querySelectorAll('*')) {
          if (item.shadowRoot) visit(item.shadowRoot)
        }
      }
      visit(document)
      return rows
    }
    const selection = '(' + selectedTreeRows.toString() + ')()'
    const readSelected = () => native.evaluate((win, script) =>
      win.webContents.devToolsWebContents?.executeJavaScript(script), selection)
    await expect.poll(readSelected).toEqual(expect.arrayContaining([expect.stringContaining('mu-atx-heading')]))

    const assertPointSelection = async(element: Locator, marker: string): Promise<void> => {
      await element.evaluate((_el, value) => {
        window.addEventListener('pointerdown', event => {
          if (event.target instanceof Element) event.target.setAttribute('data-inspector-hit', value)
        }, { capture: true, once: true })
      }, marker)
      await element.click({ position: { x: 2, y: 2 } })
      await expect.poll(readSelected).toEqual(expect.arrayContaining([expect.stringContaining(marker)]))
    }
    await native.evaluate(win => win.webContents.setZoomFactor(1.25))
    await assertPointSelection(preview.locator('h1'), 'zoomed-heading')
    await studio.getByRole('button', { name: 'Markdown source', exact: true }).click()
    await assertPointSelection(preview.locator('.CodeMirror-line').first(), 'markdown-source-line')
    await native.evaluate(win => win.webContents.setZoomFactor(1))
    await native.evaluate(win => win.webContents.closeDevTools())
    await expect(inspector).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => studio.evaluate(() => innerWidth)).toBe(width)
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout)
    await inspector.click()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await studio.reload()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout)
    await studio.getByRole('button', { name: 'AI assistant' }).click()
    await expect.poll(() => native.evaluate(win => win.webContents.isDevToolsOpened())).toBe(false)
    await expect(settings.evaluate(async() => {
      try { await window.electron.ipcRenderer.invoke('mt::theme::set-inspector', true); return 'opened' }
      catch { return 'denied' }
    })).resolves.toBe('denied')
  } finally { await app.close() }
})

test('Elements tree selections add or focus a rule in the writable theme CSS', async() => {
  const { app, page } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'pine-ink', followSystemTheme: false } })
  try {
    const studio = await openStudio(app, await openSettings(app, page))
    const native = await app.browserWindow(studio)
    await studio.getByRole('button', { name: 'CSS source' }).click()
    const input = studio.getByRole('textbox', { name: 'CSS source' })
    await input.focus()
    await studio.keyboard.insertText(layout)
    const width = await studio.evaluate(() => innerWidth)
    await studio.getByRole('button', { name: 'Inspect element' }).click()
    await expect.poll(() => studio.evaluate(() => innerWidth)).toBeLessThan(width)
    const preview = studio.frameLocator('iframe')
    const selector = studio.getByRole('combobox', { name: 'Selector', exact: true })
    await expect(studio.locator('main.inspecting')).toBeVisible()
    await preview.locator('h2.mu-atx-heading').click({ position: { x: 10, y: 6 } })
    await expect(selector).toHaveValue('.mu-atx-heading')
    const locate = studio.getByRole('button', { name: 'Go to rule' })
    await locate.click()
    await expect(input).toBeFocused()
    await studio.keyboard.insertText('padding: 12px; ')
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout.replace('margin-top', 'padding: 12px; margin-top'))

    function paragraphInTree(): { x: number; y: number } | null {
      const roots: Array<Document | ShadowRoot> = [document]
      for (const root of roots) {
        for (const row of root.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
          const label = row.textContent?.replaceAll('\u200b', '').trim() ?? ''
          if (!/^<p\b[^>]*\bmu-paragraph\b/.test(label)) continue
          const tag = row.querySelector('.webkit-html-tag-name') ?? row
          tag.scrollIntoView({ block: 'nearest' })
          const bounds = tag.getBoundingClientRect()
          if (bounds.width && bounds.height) return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        }
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) roots.push(element.shadowRoot)
        }
      }
      return null
    }
    const selectParagraph = async() => native.evaluate(async(win, script) => {
      const tools = win.webContents.devToolsWebContents
      if (!tools) return false
      const point = await tools.executeJavaScript(script)
      if (!point) return false
      const x = Math.round(point.x * tools.getZoomFactor())
      const y = Math.round(point.y * tools.getZoomFactor())
      tools.focus()
      tools.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      tools.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      return true
    }, '(' + paragraphInTree.toString() + ')()')
    await expect.poll(selectParagraph).toBe(true)
    await expect(selector).toHaveValue('.mu-paragraph')
    const base = studio.getByRole('checkbox', { name: 'View base CSS (read-only)' })
    await base.check()
    const add = studio.getByRole('button', { name: 'Add selector' })
    await add.click()
    await expect(base).not.toBeChecked()
    await expect(input).toBeFocused()
    await studio.keyboard.insertText('letter-spacing: 1.5px;')
    await expect(preview.locator('p.mu-paragraph').first()).toHaveCSS('letter-spacing', '1.5px')
    await locate.click()
    const lines = studio.locator('.css-source .CodeMirror-line')
    await expect(lines.filter({ hasText: '.mu-paragraph {' })).toHaveCount(1)
    await expect(lines.filter({ hasText: 'letter-spacing: 1.5px;' })).toHaveCount(1)
  } finally { await app.close() }
})

test('previously saved themes open as editable CSS and retain their ID', async() => {
  const id = 'local:light:bc583c7e-a40d-4828-9d4f-fe48935dfe88'
  const { app, page } = await launchWithMarkdown('## Sample', {
    preferences: { language: 'en', theme: id, followSystemTheme: false,
      localThemes: [{ version: 1, id, name: 'Older theme', base: 'light', values: { h2: '#126789' } }] }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings, true)
    const preview = studio.frameLocator('iframe')
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('color', 'rgb(18, 103, 137)')
    await studio.getByRole('button', { name: 'CSS source' }).click()
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText('#126789')
    const base = studio.getByRole('checkbox', { name: 'View base CSS (read-only)' })
    await base.check()
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(':root')
    await base.uncheck()
    await studio.getByRole('button', { name: 'Save options' }).click()
    await studio.getByRole('button', { name: 'Save and apply' }).click()
    await expect(studio.getByRole('button', { name: 'Save theme only' })).toBeEnabled()
    const prefs = await settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(prefs.localThemes).toHaveLength(1)
    expect(prefs.localThemes?.[0]).toMatchObject({ id, values: {}, css: expect.stringContaining('#126789') })
    await expect(page.locator('.mu-container h2')).toHaveCSS('color', 'rgb(18, 103, 137)')
  } finally { await app.close() }
})

test('saving an active theme creates a copy that can be applied separately', async() => {
  const id = 'local:light:bc583c7e-a40d-4828-9d4f-fe48935dfe88'
  const original = { version: 1, id, name: 'Cedar', base: 'light', values: {}, css: '' }
  const { app, page } = await launchWithMarkdown('## Editor document', {
    preferences: { language: 'en', theme: id, lightModeTheme: id, followSystemTheme: false, localThemes: [original] }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings, true)
    await studio.getByRole('button', { name: 'CSS source' }).click()
    await studio.getByRole('textbox', { name: 'CSS source' }).focus()
    await studio.keyboard.insertText(layout)
    await expect(studio.frameLocator('iframe').locator('h2.mu-atx-heading')).toHaveCSS('margin-top', '47px')
    await studio.getByRole('button', { name: 'Save theme only' }).click()
    await expect(studio.getByLabel('Theme name')).toHaveValue('Cedar (2)')

    const getPreferences = () => settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    const saved = await getPreferences()
    expect(saved.theme).toBe(id)
    expect(saved.lightModeTheme).toBe(id)
    expect(saved.localThemes).toEqual([original, expect.objectContaining({ name: 'Cedar (2)', css: layout })])
    const copyId = saved.localThemes?.find(theme => theme.name === 'Cedar (2)')?.id
    expect(copyId).toBeTruthy()
    expect(copyId).not.toBe(id)
    const heading = page.locator('.mu-container h2')
    await expect(heading).not.toHaveCSS('margin-top', '47px')

    const options = studio.getByRole('button', { name: 'Save options' })
    const apply = studio.getByRole('button', { name: 'Save and apply' })
    await options.press('Enter')
    await expect(apply).toBeFocused()
    await studio.keyboard.press('Escape')
    await expect(apply).toBeHidden()
    await expect(options).toBeFocused()
    await options.press('Enter')
    await apply.press('Enter')
    await expect(heading).toHaveCSS('margin-top', '47px')
    const applied = await getPreferences()
    expect(applied.theme).toBe(copyId)
    expect(applied.localThemes).toHaveLength(2)
  } finally { await app.close() }
})

test('AI and CSS edit one theme in an independent, reusable window', async() => {
  const headingBackground = '.mu-container h2.mu-atx-heading,\n.mu-container h2.mu-setext-heading {\n  background: #1f6feb;\n}'
  let body = ''
  let authorization = ''
  let reply: ServerResponse | undefined
  const server = createServer(async(req, res) => {
    let input = ''
    for await (const part of req) input += part
    if (JSON.parse(input).messages[0].content.startsWith('Summarize the theme version')) {
      res.end(JSON.stringify({ choices: [{ message: { content: 'Adjusted heading spacing and background and added paragraph padding.' } }] }))
      return
    }
    body = input
    authorization = req.headers.authorization ?? ''
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(streamEdit(layout) + streamEdit(headingBackground))
    reply = res
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { app, page } = await launchWithMarkdown('## PRIVATE_DOCUMENT_SENTINEL', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false }
  })
  try {
    let settings = await openSettings(app, page)
    const studio = await openStudio(app, settings)
    await expect(studio.getByRole('button', { name: 'AI assistant' })).toHaveAttribute('aria-pressed', 'true')
    await expect(settings.locator('.theme-studio')).toHaveCount(0)
    await settings.getByRole('button', { name: 'Create from current theme' }).click()
    expect(app.windows().filter(win => win.url().includes('theme-studio.html'))).toHaveLength(1)
    await (await app.browserWindow(settings)).evaluate(win => win.close())
    const preview = studio.frameLocator('iframe')
    await expect(preview.locator('h2.mu-atx-heading')).toContainText('Field journal')
    await studio.getByLabel('Theme name').fill('Cedar notes')
    const reopenedSettings = app.waitForEvent('window')
    await studio.getByRole('button', { name: 'Set up model', exact: true }).click()
    settings = await reopenedSettings
    await settings.getByRole('button', { name: 'Add model' }).click()
    const form = settings.getByRole('dialog')
    const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
    await form.getByLabel('API base URL').fill(baseUrl)
    await form.getByLabel('Model ID').fill('test-model')
    if (process.platform === 'win32') await form.getByLabel('API key', { exact: true }).fill('test-secret')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    const selected = studio.getByRole('combobox', { name: 'Model', exact: true }).locator('option:checked')
    await expect(selected).toHaveText('test-model · ' + baseUrl)
    const row = settings.getByRole('row', { name: /test-model/ })
    await row.getByRole('button', { name: 'Edit' }).click()
    await form.getByLabel('Display name (optional)').fill('My writing assistant')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(selected).toHaveText('My writing assistant')
    await (await app.browserWindow(settings)).evaluate(win => win.close())
    await studio.getByLabel('Message the theme assistant').fill('Increase the space above second-level headings')
    await studio.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('margin-top', '47px')
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('background-color', 'rgb(31, 111, 235)')
    await studio.getByRole('button', { name: 'CSS source' }).click()
    const lines = studio.locator('.css-source .CodeMirror-code')
    await expect(lines).toContainText(layout)
    reply?.end(streamEdit(paragraph) + 'data: [DONE]\n\n')
    await expect(preview.locator('.mu-paragraph').first()).toHaveCSS('padding-inline-start', '18px')
    await studio.getByRole('button', { name: 'Undo last change' }).click()
    await expect(preview.locator('h2.mu-atx-heading')).not.toHaveCSS('margin-top', '47px')
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('background-color', 'rgb(17, 151, 125)')
    await expect(lines).not.toContainText(layout)
    const input = studio.getByRole('textbox', { name: 'CSS source' })
    await input.focus()
    await studio.keyboard.insertText(layout + '\n' + headingBackground)
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('margin-top', '47px')
    await studio.keyboard.insertText('\np {')
    await expect(studio.getByRole('alert')).toBeVisible()
    await expect(studio.getByRole('button', { name: 'Save theme only' })).toBeDisabled()
    await expect(studio.getByRole('button', { name: 'Save options' })).toBeDisabled()
    await expect(preview.locator('h2.mu-atx-heading')).toHaveCSS('margin-top', '47px')
    await studio.keyboard.insertText(' margin: 1em; }')
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await studio.getByRole('button', { name: 'Save options' }).click()
    await studio.getByRole('button', { name: 'Save and apply' }).click()
    await expect(studio.getByRole('button', { name: 'Save theme only' })).toBeEnabled()
    await expect(page.locator('.mu-container h2')).toHaveCSS('margin-top', '47px')
    await expect(page.locator('.mu-container h2')).toHaveCSS('background-color', 'rgb(31, 111, 235)')
    expect(JSON.parse(body).model).toBe('test-model')
    expect(body).not.toContain('PRIVATE_DOCUMENT_SENTINEL')
    expect(body).not.toContain('test-secret')
    if (process.platform === 'win32') expect(authorization).toBe('Bearer test-secret')

    settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Edit current theme' }).click()
    let reopened = studio
    await reopened.getByLabel('Theme name').fill('Unpublished revision')
    await (await app.browserWindow(reopened)).evaluate(win => win.close())
    reopened = await openStudio(app, settings, true)
    await expect(reopened.getByLabel('Theme name')).toHaveValue('Unpublished revision')
    const saved = await settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(saved.localThemes?.[0].name).toBe('Cedar notes')
    const directory = await app.evaluate(({ app }) => app.getPath('userData'))
    const exported = join(directory, 'cedar.theme.json')
    await app.evaluate(({ dialog }, pathname) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: pathname })
    }, exported)
    await reopened.getByRole('button', { name: 'Theme files', exact: true }).click()
    const themeFiles = reopened.getByRole('dialog', { name: 'Theme files', exact: true })
    await expect(themeFiles.getByRole('button', { name: 'Import as a copy' })).toBeVisible()
    await themeFiles.getByRole('button', { name: 'Export theme' }).click()
    await expect.poll(async() => JSON.parse(await readFile(exported, 'utf8').catch(() => '{}')).css).toContain(layout)
    await reopened.locator('input[type=file][accept=".json"]').setInputFiles(exported)
    await expect(reopened.getByRole('combobox', { name: 'Base theme' })).toBeEnabled()
    await reopened.getByRole('button', { name: 'Save options' }).click()
    await reopened.getByRole('button', { name: 'Save and apply' }).click()
    await expect(reopened.getByRole('button', { name: 'Save theme only' })).toBeEnabled()
    const imported = await settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(imported.localThemes).toHaveLength(2)
    expect(imported.theme).not.toBe(saved.theme)
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('theme history persists manual edits, AI summaries and repeated saves and restores a draft', async() => {
  const summary = 'Added inline padding to paragraphs.'
  let summaryInput: unknown
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    const { stream, messages } = JSON.parse(body)
    const content = stream ? JSON.stringify({ find: '', replace: paragraph }) + '\n' + JSON.stringify({ message: 'Done.' }) : summary
    if (!stream) summaryInput = JSON.parse(messages[1].content)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const profile = { id: 'history', model: 'test', encryptedKey: '', baseUrl, requestType: 'chat-completions',
    reasoningEffort: '', contextSize: null, outputSize: null, inputTypes: [] }
  const { app, page } = await launchWithMarkdown('## Heading\n\nParagraph', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) }
  })
  try {
    const studio = await openStudio(app, await openSettings(app, page))
    const trigger = studio.getByRole('button', { name: 'Version history' })
    const history = studio.getByRole('dialog', { name: 'Version history' })
    const save = studio.getByRole('button', { name: 'Save theme only' })
    await studio.getByRole('button', { name: 'CSS source' }).click()
    await studio.getByRole('textbox', { name: 'CSS source' }).focus()
    await studio.keyboard.insertText(layout)
    await trigger.click()
    const rows = history.getByRole('navigation').getByRole('button')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Manual edit')
    await history.getByRole('button', { name: 'Close', exact: true }).click()
    await studio.getByRole('button', { name: 'AI assistant' }).click()
    await studio.getByLabel('Message the theme assistant').fill('Add paragraph padding')
    await studio.getByRole('button', { name: 'Send', exact: true }).click()
    await trigger.click()
    await expect(rows.first()).toContainText(summary)
    expect(summaryInput).toEqual([{ field: 'css', location: '.mu-container p.mu-paragraph › padding-inline', before: null, after: '18px' }])
    await history.getByRole('button', { name: 'Close', exact: true }).click()
    await studio.getByRole('button', { name: 'Save options' }).click()
    await studio.getByRole('button', { name: 'Save and apply', exact: true }).click()
    await expect(page.locator('.mu-paragraph')).toHaveCSS('padding-inline-start', '18px')
    await save.click()
    await save.click()
    await trigger.click()
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('Saved the theme.')
    await expect(rows.nth(1)).toContainText('Saved the theme.')
    const prefs = await studio.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(prefs.localThemes).toHaveLength(1)
    await history.getByRole('button', { name: /Manual edit/ }).click()
    await history.getByRole('button', { name: 'Theme preview', exact: true }).click()
    await expect(history.frameLocator('iframe').locator('h2.mu-atx-heading')).toHaveCSS('margin-top', '47px')
    await history.getByRole('button', { name: 'Restore as draft' }).click()
    await history.getByRole('button', { name: 'Confirm restore' }).click()
    await expect(rows).toHaveCount(7)
    await expect(rows.first()).toContainText('Current draft')
    await expect(page.locator('.mu-paragraph')).toHaveCSS('padding-inline-start', '18px')
    await studio.reload()
    await trigger.click()
    await expect(rows).toHaveCount(7)
    await expect(rows.first()).toContainText('Restored the version')
    await expect(rows.getByText(summary)).toBeVisible()
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})
