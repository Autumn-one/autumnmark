import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { clickMenuById, enterSourceMode, exitSourceMode, getMarkdownContent, launchElectron, launchWithMarkdown, sendIpcToRenderer, waitForEditor, waitForMenuReady } from './helpers'

test('sidebar guides users without a model to external editing or model setup', async() => {
  const original = '# Meeting notes\n\nDraft action items\n'
  const { app, page } = await launchWithMarkdown(original, {
    preferences: { language: 'en', autoSave: false, theme: 'light', followSystemTheme: false },
    windowLayout: { showSideBar: true, showTabBar: true }
  })
  try {
    await app.evaluate(({ clipboard }) => {
      let copied = ''
      clipboard.writeText = async text => { copied = text }
      clipboard.readText = async() => copied
    })
    const readClipboard = () => page.evaluate(() => window.electron.clipboard.readText())
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: 'AI', exact: true })
    const configure = panel.getByRole('button', { name: 'Configure AI models' })
    const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
    await expect(configure).toBeVisible()
    await expect(composer).toHaveCount(0)
    const external = panel.getByRole('button', { name: 'Use an external AI client' })
    await external.click()
    const skillDialog = page.getByRole('dialog', { name: 'Use an external AI client' })
    await expect(skillDialog).toContainText('Call the autumnmark Skill')
    await expect(skillDialog).toContainText('asks you to choose one')
    await expect(page.evaluate(() => window.electron.ipcRenderer.invoke('mt::autumnmark-skill::status'))).resolves.toBe('ready')
    await expect(skillDialog.getByRole('button', { name: 'Install Skill', exact: true })).toHaveCount(0)
    await skillDialog.getByRole('button', { name: 'Copy invocation' }).click()
    expect(await readClipboard()).toMatch(/autumnmark Skill.*document/)
    await skillDialog.getByRole('button', { name: 'Edit theme', exact: true }).click()
    await expect(skillDialog).toContainText('current draft')
    await skillDialog.getByRole('button', { name: 'Copy invocation' }).click()
    expect(await readClipboard()).toMatch(/autumnmark Skill.*theme/)
    await page.keyboard.press('Escape')
    await expect(skillDialog).toBeHidden()
    await expect(external).toBeFocused()
    const openedSettings = app.waitForEvent('window')
    await configure.click()
    const settings = await openedSettings
    const modelTable = settings.getByRole('table', { name: 'AI models' })
    await expect(modelTable).toBeVisible()
    await settings.getByRole('button', { name: 'Add model' }).click()
    const dialog = settings.getByRole('dialog')
    await dialog.getByLabel('API base URL').fill('http://127.0.0.1:12345/v1')
    await dialog.getByLabel('Model ID').fill('example-model')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modelTable.getByRole('row', { name: /example-model/ })).toBeVisible()
    await expect(composer).toBeVisible()
    await expect(configure).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('sidebar sends the full long note to the model and applies its replacement', async() => {
  const original = '# Original note\n\n```text\n' + ('PRIVATE_NOTE_TEXT '.repeat(40).trimEnd() + '\n').repeat(1600) + '```\n'
  const demo = '# Markdown demo\n\n- **Bold** and *italic*\n- `Inline code`\n\n> A quotation\n'
  const contexts: Record<string, unknown>[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    const { messages } = JSON.parse(body)
    const context = JSON.parse(messages.at(-1).content)
    contexts.push(context)
    const response = context.markdown !== undefined ? { reply: 'Created a Markdown demo.', replaceMarkdown: demo }
      : { read: ['markdown'] }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const model = { id: 'notes', model: 'test', baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1',
    encryptedKey: '', requestType: 'chat-completions', reasoningEffort: '', contextSize: 4096, outputSize: 1024, inputTypes: [] }
  let running: Awaited<ReturnType<typeof launchWithMarkdown>> | undefined
  try {
    running = await launchWithMarkdown(original, {
      preferences: { language: 'en', autoSave: false },
      windowLayout: { showSideBar: true, showTabBar: true },
      userDataFiles: { 'theme-model.json': JSON.stringify([model]) }
    })
    const { app, page, filePath } = running
    await enterSourceMode(page, app)
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: 'AI', exact: true })
    const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
    await composer.fill('Replace the current note with a Markdown demo.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    const undo = panel.getByRole('button', { name: 'Undo changes' })
    await expect(undo).toBeEnabled()
    expect(contexts).toHaveLength(2)
    expect(contexts[0].availableContext).toContain('markdown')
    expect(contexts[0]).not.toHaveProperty('markdown')
    expect(contexts[1]).not.toHaveProperty('unavailableContext')
    expect(contexts[1].markdown).toBe(original)
    expect(await getMarkdownContent(page, app)).toBe(demo)
    expect(readFileSync(filePath, 'utf8')).toBe(original)

    await undo.click()
    await expect(panel.getByText('Changes reverted', { exact: true })).toBeVisible()
    expect(await getMarkdownContent(page, app)).toBe(original)
  } finally {
    server.closeAllConnections()
    server.close()
    await running?.app.close()
  }
})

test('sidebar chat applies and reverts document and theme edits and opens its screenshots', async() => {
  const root = mkdtempSync(path.join(tmpdir(), 'autumnmark-document-chat-'))
  const userDataDir = path.join(root, 'profile')
  const file = path.join(root, 'note.md')
  const original = '# Old title\n\nPRIVATE_NOTE_TEXT\n'
  const followUp = 'Follow-up\n question\nAnother line'
  writeFileSync(file, original)
  const requests: { messages: { role: string; content: string }[]; max_completion_tokens?: number }[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    const request = JSON.parse(body)
    requests.push(request)
    const input = request.messages.at(-1).content
    const context = input.startsWith('{') ? JSON.parse(input) : { request: input }
    const prompt = context.request
    let content = 'A response to ' + prompt
    if (prompt === followUp) {
      content = JSON.stringify({ reply: 'Here is the current note.', capturePreview: true })
    } else if ((prompt.includes('Improve the title') || prompt.includes('Polish the title')) && context.markdown === undefined) {
      content = JSON.stringify({ read: ['markdown'] })
    } else if (prompt.includes('Improve the title')) {
      content = JSON.stringify({ reply: 'Suggested a new title.', edits: [{ find: '# Old title', replace: '# New title' }] })
    } else if (prompt.includes('Polish the title')) {
      content = JSON.stringify({ reply: 'Suggested a final title.', edits: [{ find: '# New title', replace: '# Final title' }] })
    } else if (prompt === 'Update text and color') {
      content = context.themeCss === undefined || context.markdown === undefined
        ? JSON.stringify({ read: ['markdown', 'themeCss'] })
        : JSON.stringify({ reply: 'Changed both.', edits: [{ find: 'PRIVATE_NOTE_TEXT', replace: 'Combined edit' }],
          themeEdits: [{ find: '', replace: ':root { --editorColor: #712345; }' }] })
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const model = { id: 'notes', model: 'test', baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1',
    encryptedKey: '', requestType: 'chat-completions', reasoningEffort: '', contextSize: 1_048_576, outputSize: 384_000, inputTypes: [] }
  const launch = (seed = false) => launchElectron([file], {
    userDataDir,
    windowLayout: { showSideBar: true, showTabBar: true },
    ...(seed ? { preferences: { language: 'en', autoSave: false }, userDataFiles: { 'theme-model.json': JSON.stringify([model]) } } : {})
  })
  async function openChat(page: Page) {
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: 'AI', exact: true })
    const history = panel.getByRole('button', { name: 'Conversation', exact: true })
    const historyList = panel.getByRole('dialog', { name: 'Conversation', exact: true })
    const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
    const sendButton = panel.getByRole('button', { name: 'Send', exact: true })
    async function send(prompt: string) {
      await composer.fill(prompt)
      await sendButton.click()
    }
    async function selectConversation(title: string) {
      await history.click()
      await historyList.getByRole('button', { name: title, exact: true }).click()
    }
    return { panel, history, historyList, composer, sendButton, send, selectConversation }
  }

  let running: Awaited<ReturnType<typeof launch>> | undefined
  try {
    running = await launch(true)
    const { app, page } = running
    await waitForEditor(page)
    await waitForMenuReady(app)
    const { panel, composer, sendButton, send, selectConversation } = await openChat(page)
    await expect(panel.getByRole('checkbox')).toHaveCount(0)
    const modelBox = await panel.getByRole('combobox', { name: 'Model', exact: true }).boundingBox()
    const sendBox = await sendButton.boundingBox()
    expect(modelBox).not.toBeNull()
    expect(sendBox).not.toBeNull()
    expect(Math.abs((modelBox?.y ?? 0) - (sendBox?.y ?? 0))).toBeLessThan(3)
    expect((modelBox?.x ?? 0) + (modelBox?.width ?? 0)).toBeLessThan(sendBox?.x ?? 0)
    await composer.fill('First question')
    await composer.press('Enter')
    await expect(panel.getByText('A response to First question')).toBeVisible()
    expect(requests[0].max_completion_tokens).toBe(model.outputSize)
    expect(JSON.stringify(requests[0])).not.toContain('PRIVATE_NOTE_TEXT')
    const firstContext = JSON.parse(requests[0].messages.at(-1)?.content ?? '')
    expect(firstContext.availableContext).toEqual(['markdown', 'themeCss', 'baseCss'])
    for (const source of firstContext.availableContext) expect(firstContext).not.toHaveProperty(source)
    await expect(panel.locator('.prompt')).toHaveCSS('justify-self', 'right')
    await expect(panel.locator('.assistant-message')).toHaveCSS('justify-self', 'left')
    await composer.fill('Follow-up question\nAnother line')
    await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(9, 9))
    await composer.press('Shift+Enter')
    await expect(composer).toHaveValue(followUp)
    expect(await composer.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(10)
    expect(requests).toHaveLength(1)
    await composer.press('Enter')
    await expect(panel.getByText('Here is the current note.')).toBeVisible()
    const screenshot = panel.getByRole('button', { name: 'Preview screenshot 1' })
    await expect(screenshot).toBeVisible()
    await expect.poll(() => screenshot.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await screenshot.click()
    const viewer = page.getByRole('dialog', { name: 'Preview screenshot 1' })
    await expect(viewer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    expect(requests[1].messages.slice(1).map(message =>
      message.content.startsWith('{') ? JSON.parse(message.content).request : message.content
    )).toEqual([
      'First question', 'A response to First question', followUp
    ])

    await panel.getByRole('button', { name: 'New chat' }).click()
    await expect(panel.getByText('A response to First question')).toHaveCount(0)
    await enterSourceMode(page, app)
    await send('Improve the title')
    await expect(panel.getByText('Suggested a new title.')).toBeVisible()
    expect(requests[2].messages).toHaveLength(2)
    expect(JSON.stringify(requests[2])).not.toContain('PRIVATE_NOTE_TEXT')
    const markdownContext = JSON.parse(requests[3].messages.at(-1)?.content ?? '')
    expect(markdownContext).toMatchObject({ request: 'Improve the title', markdown: original })
    expect(markdownContext).not.toHaveProperty('themeCss')
    expect(markdownContext).not.toHaveProperty('baseCss')

    await panel.getByText('Review changes to note.md', { exact: true }).click()
    await expect(panel.locator('del')).toHaveText('# Old title')
    await expect(panel.locator('ins')).toHaveText('# New title')
    expect(readFileSync(file, 'utf8')).toBe(original)
    await expect(panel.getByText('Changes applied to the editor.')).toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).toBe(original.replace('Old title', 'New title'))

    await selectConversation('First question')
    await expect(screenshot).toBeVisible()
    await app.close()
    running = await launch()
    await waitForEditor(running.page)
    const reopened = await openChat(running.page)
    await reopened.selectConversation('First question')
    await expect(reopened.panel.getByRole('button', { name: 'Preview screenshot 1' })).toBeVisible()

    const { app: reopenedApp, page: reopenedPage } = running
    await waitForMenuReady(reopenedApp)
    const historyButton = reopenedPage.locator('.sidebar-footer').getByRole('button', { name: 'History', exact: true })
    const history = reopenedPage.getByRole('dialog', { name: 'Version history' })
    const historyEntries = history.getByRole('navigation')
    const titleChange = historyEntries.getByRole('button', { name: /Document .*Improve the title/ })
    await reopenedPage.getByRole('tab', { name: 'Files', exact: true }).click()
    await historyButton.click()
    await expect(titleChange).toHaveAttribute('aria-pressed', 'true')
    await expect(history.locator('del')).toHaveText('# Old title')
    await expect(history.locator('ins')).toHaveText('# New title')
    await history.getByRole('button', { name: 'View conversation' }).click()
    await expect(history).toBeHidden()
    await expect(reopened.panel.getByText('Suggested a new title.')).toBeVisible()
    await expect(reopened.panel.getByText('Changes applied to the editor.')).toBeVisible()

    await exitSourceMode(reopenedPage, reopenedApp)
    const heading = reopenedPage.locator('.mu-container h1')
    await expect(heading).toContainText('New title')
    const paragraph = reopenedPage.locator('.mu-container .mu-paragraph')
    await paragraph.click()
    await reopenedPage.keyboard.press('End')
    await reopenedPage.keyboard.insertText(' updated by hand')
    await expect(paragraph).toContainText('updated by hand')
    await reopened.send('Polish the title')
    await expect(heading).toContainText('Final title')
    await expect(paragraph).toContainText('updated by hand')
    const styled = () => reopenedPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editorColor').trim())
    const originalColor = await styled()
    await reopened.send('Update text and color')
    await expect(paragraph).toContainText('Combined edit')
    await expect.poll(styled).toBe('#712345')

    await clickMenuById(reopenedApp, 'openActiveThemeHistory')
    const currentTheme = historyEntries.getByRole('button', { name: /^Theme .*Currently applied/ })
    await expect(currentTheme).toHaveAttribute('aria-pressed', 'true')
    await expect(history.getByRole('button', { name: /^(Document|Theme)$/ })).toHaveCount(0)
    await titleChange.click()
    await expect(history.locator('ins')).toHaveText('# New title')
    await history.getByRole('button', { name: 'Close', exact: true }).click()

    const combinedTurn = reopened.panel.locator('.turn').filter({ hasText: 'Changed both.' })
    await combinedTurn.getByRole('button', { name: 'Undo changes' }).click()
    await expect(paragraph).toContainText('PRIVATE_NOTE_TEXT updated by hand')
    await expect.poll(styled).toBe(originalColor)
    await expect(combinedTurn.getByText('Changed both.')).toBeVisible()
    await expect(combinedTurn.getByText('Changes reverted')).toBeVisible()
    await historyButton.click()
    await expect(history.getByText('Changes reverted', { exact: true })).toBeVisible()
    await history.getByRole('button', { name: 'Close', exact: true }).click()

    await reopened.send('Update text and color')
    await expect(paragraph).toContainText('Combined edit')
    await expect.poll(styled).toBe('#712345')
    const earlierTurn = reopened.panel.locator('.turn').filter({ hasText: 'Suggested a new title.' })
    await earlierTurn.getByRole('button', { name: 'Turn actions' }).click()
    await reopenedPage.getByRole('menuitem', { name: 'Delete this turn' }).click()
    await expect(earlierTurn).toHaveCount(0)
    await expect(heading).toContainText('Final title')

    await expect(reopened.panel.getByRole('button', { name: /^Delete chat/ })).toHaveCount(0)
    await reopened.history.click()
    await reopened.historyList.getByRole('button', { name: 'Delete chat · Polish the title' }).click()
    await expect(reopened.historyList.getByRole('button', { name: 'Delete chat · Polish the title' })).toHaveCount(0)
    await expect(reopened.history).toHaveText('First question')
    await expect(heading).toContainText('Final title')
    await expect(paragraph).toContainText('Combined edit updated by hand')
    await expect.poll(styled).toBe('#712345')
  } finally {
    server.closeAllConnections()
    server.close()
    await running?.app.close()
    rmSync(root, { recursive: true, force: true })
  }
})
