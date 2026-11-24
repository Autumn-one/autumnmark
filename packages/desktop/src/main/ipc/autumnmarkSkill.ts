import { randomBytes, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { app, ipcMain, type WebContents } from 'electron'
import log from 'electron-log'
import writeAtomic from 'write-file-atomic'
import { isSkillThemeProbe, maxSkillMarkdownLength, type SkillDocument, type SkillTheme, type SkillWindowRequest, type SkillWindowResponse } from '@shared/autumnmarkSkill'
import { maxThemeCss } from '@shared/themeCss'
import type Accessor from '../app/accessor'
import { WindowLifecycle, WindowType, type WindowTypeValue } from '../windows/base'
import { requireModelWindow } from './aiModels'
import type { SkillActiveTheme } from './themeStudio'
import { prepareAutumnMarkSkill } from './skillInstall'

const revisionPattern = /^[a-f0-9]{64}$/

function themeInfo({ id, name, base, scope }: SkillTheme): SkillTheme {
  return { id, name, base, scope }
}

async function readRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []
  let length = 0
  for await (const part of request as AsyncIterable<Buffer>) {
    length += part.length
    if (length > maxSkillMarkdownLength * 6 + 4096) throw new Error('request-too-large')
    parts.push(part)
  }
  const value: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-request')
  return value as Record<string, unknown>
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

export function registerAutumnMarkSkill(accessor: Accessor, appliedTheme: SkillActiveTheme): void {
  const home = process.env.MARKTEXT_TEST_SKILL_HOME ?? homedir()
  const instance = randomUUID()
  const token = randomBytes(32).toString('hex')
  const pending = new Map<string, { sender: WebContents; resolve: (result: SkillWindowResponse) => void }>()
  let endpoint: { server: Server; path: string } | undefined
  let focusedAt = Date.now()
  let editorFocusedAt = 0
  let stopped = false

  const windows = (type: WindowTypeValue) => accessor.windowManager.getWindowsByType(type)
    .filter(({ win }) => win.browserWindow && !win.browserWindow.isDestroyed())

  ipcMain.on('mt::autumnmark-skill::response', (event, id: string, result: SkillWindowResponse) => {
    const request = pending.get(id)
    if (request?.sender === event.sender && event.senderFrame === event.sender.mainFrame) request.resolve(result)
  })

  async function fromWindow<T>(entry: ReturnType<typeof windows>[number], request: SkillWindowRequest): Promise<T> {
    const sender = entry.win.browserWindow?.webContents
    if (!sender || sender.isDestroyed() || entry.win.lifecycle !== WindowLifecycle.READY) throw new Error('window-not-ready')
    const id = randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await new Promise<SkillWindowResponse>((resolve, reject) => {
        pending.set(id, { sender, resolve })
        timer = setTimeout(() => reject(new Error('window-not-ready')), 4000)
        sender.send('mt::autumnmark-skill::request', id, request)
      })
      if (!result.ok) throw new Error(result.error)
      return result.value as T
    } finally {
      clearTimeout(timer)
      pending.delete(id)
    }
  }

  async function listDocuments() {
    const entries = await Promise.all(windows(WindowType.EDITOR).map(async entry => {
      const documents = await fromWindow<SkillDocument[]>(entry, { action: 'documents' })
      return documents.map(document => ({ ...document, windowId: entry.id }))
    }))
    return entries.flat()
  }

  function themeEditor() {
    return windows(WindowType.STUDIO)[0]
  }

  function activeEditor() {
    const editors = windows(WindowType.EDITOR)
    return editors.find(item => item.id === accessor.windowManager.getActiveEditorId()) ?? editors[0]
  }

  async function handle(request: Record<string, unknown>) {
    const { action, id, windowId, revision, markdown, css } = request
    if (action === 'targets') {
      const studio = themeEditor()
      const documents = await listDocuments()
      const activeTheme = themeInfo(appliedTheme.read())
      const theme = studio ? themeInfo(await fromWindow<SkillTheme>(studio, { action: 'theme-info' })) : activeTheme
      return { documents, theme, activeTheme, activeEditorId: activeEditor()?.id ?? null, editorFocusedAt, focusedAt }
    }
    if (action === 'read-document' || action === 'edit-document') {
      const documents = await listDocuments()
      if (documents.length !== 1 && request.confirmed !== true) throw new Error('document-confirmation-required')
      const target = documents.find(document => document.windowId === windowId && document.id === id)
      const entry = windows(WindowType.EDITOR).find(window => window.id === windowId)
      if (!entry || !target?.editable) throw new Error('document-unavailable')
      if (action === 'read-document') return fromWindow(entry, { action, id: target.id })
      if (typeof markdown !== 'string' || markdown.length > maxSkillMarkdownLength ||
        typeof revision !== 'string' || !revisionPattern.test(revision)) throw new Error('invalid-request')
      return fromWindow(entry, { action, id: target.id, revision, markdown })
    }
    if (action === 'theme-workspace') {
      const studio = themeEditor()
      if (!studio || typeof id !== 'string') throw new Error('theme-editor-unavailable')
      return fromWindow(studio, { action, id })
    }
    if (action === 'read-theme' || action === 'edit-theme' || action === 'measure-theme') {
      const explicitActive = request.scope === 'active' && request.explicit === true
      const studio = explicitActive ? undefined : themeEditor()
      if (typeof id !== 'string' || request.scope !== (studio ? 'draft' : 'active')) throw new Error('theme-target-changed')
      const editor = studio ? undefined : activeEditor()
      const activeDestinationChanged = () => (!explicitActive && !!themeEditor()) || activeEditor()?.id !== editor?.id
      if (action === 'measure-theme') {
        const probe = request.probe
        if (!isSkillThemeProbe(probe)) throw new Error('invalid-theme-measurement')
        if (studio) return fromWindow(studio, { action, id, probe })
        const theme = appliedTheme.read()
        if (theme.id !== id) throw new Error('theme-target-changed')
        if (!editor) throw new Error('theme-preview-unavailable')
        const measurement = await fromWindow(editor, { action: 'active-theme', revision: theme.revision, query: { probe } })
        if (activeDestinationChanged() || appliedTheme.read().revision !== theme.revision) throw new Error('theme-target-changed')
        return measurement
      }
      if (action === 'read-theme') {
        if (studio) {
          const read = await fromWindow<SkillTheme>(studio, { action })
          if (read.id !== id) throw new Error('theme-target-changed')
          return read
        }
        const theme = appliedTheme.read()
        if (theme.id !== id) throw new Error('theme-target-changed')
        const baseCss = editor
          ? await fromWindow<string>(editor, { action: 'active-theme', revision: theme.revision, query: { base: theme.base } })
          : ''
        if (activeDestinationChanged() || appliedTheme.read().revision !== theme.revision) throw new Error('theme-target-changed')
        return { ...theme, baseCss }
      }
      if (typeof css !== 'string' || css.length > maxThemeCss ||
        typeof revision !== 'string' || !revisionPattern.test(revision)) throw new Error('invalid-request')
      if (studio) return fromWindow(studio, { action, id, revision, css })
      const theme = appliedTheme.read()
      if (theme.id !== id || theme.revision !== revision) throw new Error('theme-changed')
      if (editor) await fromWindow(editor, { action: 'active-theme', revision })
      if (activeDestinationChanged()) throw new Error('theme-target-changed')
      const result = appliedTheme.edit(id, revision, css)
      return { ...result, ...themeInfo(appliedTheme.read()) }
    }
    throw new Error('invalid-request')
  }

  async function receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/skill' || request.headers.authorization !== `Bearer ${token}`) {
      reply(response, 403, { status: 'error', error: 'not-authorized' })
      return
    }
    try {
      const input = await readRequest(request)
      const value = await handle(input)
      reply(response, 200, { status: 'ok', ...value as object })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      reply(response, 400, { status: 'error', error: /^[a-z][a-z-]{1,63}$/.test(message) ? message : 'operation-failed' })
    }
  }

  async function start(): Promise<void> {
    const directory = join(home, '.autumnmark', 'skill', 'instances')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (!(await lstat(directory)).isDirectory()) throw new Error('invalid-skill-directory')
    const path = join(directory, instance + '.json')
    const server = createServer((request, response) => { void receive(request, response) })
    server.requestTimeout = 8000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (stopped || !address || typeof address === 'string') throw new Error('skill-bridge-unavailable')
      await writeAtomic(path, JSON.stringify({ instance, port: address.port, token }), { mode: 0o600 })
      endpoint = { server, path }
      if (stopped) stop()
    } catch (error) {
      server.close()
      throw error
    }
  }

  function stop(): void {
    if (!endpoint) return
    endpoint.server.close()
    endpoint.server.closeAllConnections()
    rmSync(endpoint.path, { force: true })
    endpoint = undefined
  }

  const ready = app.whenReady().then(async() => {
    const appImage = process.env.APPIMAGE
    const runtime = appImage && isAbsolute(appImage) ? appImage : process.execPath
    const [bridge, installation] = await Promise.allSettled([
      start(), prepareAutumnMarkSkill(home, join(__static, 'skills', 'autumnmark'), runtime)
    ])
    if (bridge.status === 'rejected' || installation.status === 'rejected') {
      for (const result of [bridge, installation]) {
        if (result.status === 'rejected') log.warn('AutumnMark Skill startup failed', result.reason)
      }
      return 'failed' as const
    }
    return installation.value
  })
  ipcMain.handle('mt::autumnmark-skill::status', event => {
    requireModelWindow(accessor, event, WindowType.EDITOR)
    return ready
  })

  app.on('browser-window-focus', (_event, window) => {
    focusedAt = Date.now()
    if (accessor.windowManager.get(window.id)?.type === WindowType.EDITOR) editorFocusedAt = focusedAt
  })
  app.once('will-quit', () => {
    stopped = true
    stop()
  })
}
