// @vitest-environment node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillDocument, SkillWindowRequest, SkillWindowResponse } from '@shared/autumnmarkSkill'

type IpcOnListener = (event: unknown, ...args: unknown[]) => void
type IpcHandleListener = (event: unknown, ...args: unknown[]) => unknown

const ipcOnListeners = new Map<string, IpcOnListener>()
const ipcHandleListeners = new Map<string, IpcHandleListener>()
const appListeners = new Map<string, ((...args: unknown[]) => void)[]>()

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ id: 1 })
  },
  app: {
    whenReady: () => Promise.resolve(),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = appListeners.get(event) ?? []
      list.push(listener)
      appListeners.set(event, list)
    },
    once: (event: string, listener: (...args: unknown[]) => void) => {
      const list = appListeners.get(event) ?? []
      list.push(listener)
      appListeners.set(event, list)
    }
  },
  ipcMain: {
    on: (channel: string, listener: IpcOnListener) => {
      ipcOnListeners.set(channel, listener)
    },
    handle: (channel: string, listener: IpcHandleListener) => {
      ipcHandleListeners.set(channel, listener)
    }
  }
}))

vi.mock('electron-log', () => ({
  default: { warn: vi.fn() }
}))

import { registerAutumnMarkSkill } from 'main_renderer/ipc/autumnmarkSkill'
import { WindowLifecycle, WindowType } from 'main_renderer/windows/base'

interface TabFixture {
  id: string
  name: string
  path: string
  editable: boolean
  markdown: string
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

async function runBridge(
  home: string,
  args: string[],
  input?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const bridge = path.resolve(__dirname, '../../../static/skills/autumnmark/bridge.cjs')
  const child = spawn(process.execPath, [bridge, ...args], {
    env: { ...process.env, MARKTEXT_TEST_SKILL_HOME: home },
    windowsHide: true
  })
  const closed = once(child, 'close')
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.stdin.end(input ? JSON.stringify(input) : '')
  await closed
  if (!stdout) throw new Error(stderr || 'bridge.cjs produced no output')
  return JSON.parse(stdout) as Record<string, unknown>
}

describe('AutumnMark Skill document session lock', () => {
  let home = ''
  let tabs: TabFixture[] = []
  let activeTabId = 'tab-1'

  beforeEach(async() => {
    ipcOnListeners.clear()
    ipcHandleListeners.clear()
    appListeners.clear()
    home = mkdtempSync(path.join(tmpdir(), 'autumnmark-skill-session-'))
    process.env.MARKTEXT_TEST_SKILL_HOME = home
    ;(globalThis as Record<string, unknown>).__static = path.resolve(__dirname, '../../../static')

    tabs = [
      { id: 'tab-1', name: '1.md', path: path.join(home, '1.md'), editable: true, markdown: '# First\n' },
      { id: 'tab-2', name: '2.md', path: path.join(home, '2.md'), editable: true, markdown: '# Second\n' }
    ]
    activeTabId = 'tab-1'

    const sender = {
      id: 10,
      mainFrame: 'main',
      isDestroyed: () => false,
      send: (channel: string, requestId: string, request: SkillWindowRequest) => {
        if (channel !== 'mt::autumnmark-skill::request') return
        let response: SkillWindowResponse
        if (request.action === 'documents') {
          const docs: SkillDocument[] = tabs.map(({ id, name, path: filePath, editable }) => ({
            id, name, path: filePath, editable, active: id === activeTabId
          }))
          response = { ok: true, value: docs }
        } else if (request.action === 'read-document') {
          const tab = tabs.find(item => item.id === request.id)
          response = tab
            ? { ok: true, value: { markdown: tab.markdown, revision: sha256(tab.markdown) } }
            : { ok: false, error: 'document-unavailable' }
        } else if (request.action === 'edit-document') {
          const tab = tabs.find(item => item.id === request.id)
          if (!tab) response = { ok: false, error: 'document-unavailable' }
          else if (sha256(tab.markdown) !== request.revision) response = { ok: false, error: 'document-changed' }
          else {
            tab.markdown = request.markdown
            response = { ok: true, value: { changed: true } }
          }
        } else {
          response = { ok: false, error: 'invalid-request' }
        }
        const listener = ipcOnListeners.get('mt::autumnmark-skill::response')
        queueMicrotask(() => {
          listener?.({ sender, senderFrame: 'main' }, requestId, response)
        })
      }
    }

    const fakeWin = {
      type: WindowType.EDITOR,
      lifecycle: WindowLifecycle.READY,
      browserWindow: { isDestroyed: () => false, webContents: sender }
    }
    const accessor = {
      windowManager: {
        get: () => fakeWin,
        getActiveEditorId: () => 1,
        getWindowsByType: (type: string) => type === WindowType.EDITOR ? [{ id: 1, win: fakeWin }] : []
      }
    }
    const appliedTheme = {
      read: () => ({ id: 'light', name: 'Light', base: 'light', scope: 'active' as const, css: '', revision: sha256('') }),
      edit: () => ({ changed: false })
    }

    registerAutumnMarkSkill(accessor as never, appliedTheme)
    const statusHandler = ipcHandleListeners.get('mt::autumnmark-skill::status')
    const status = await statusHandler?.({ sender, senderFrame: 'main' })
    expect(status).toBe('ready')
  })

  afterEach(() => {
    for (const listener of appListeners.get('will-quit') ?? []) listener()
    delete process.env.MARKTEXT_TEST_SKILL_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('keeps subsequent reads and edits locked to the first document even after switching tabs', async() => {
    const first = await runBridge(home, ['read-document', '--editor'])
    expect(first).toMatchObject({ status: 'ok', name: '1.md', markdown: '# First\n' })
    expect(typeof first.session).toBe('string')
    const session = first.session as string

    // User switches to 2.md while the external AI conversation is still in progress.
    activeTabId = 'tab-2'
    const targets = await runBridge(home, ['targets'])
    const doc2 = (targets.documents as { target: string; name: string }[]).find(item => item.name === '2.md')
    if (!doc2) throw new Error('Expected 2.md in targets')

    // Follow-up read with --session stays pinned to 1.md even if --editor is passed.
    const reread = await runBridge(home, ['read-document', '--session', session, '--editor'])
    expect(reread).toMatchObject({
      status: 'ok',
      name: '1.md',
      target: first.target,
      confirmed: first.target,
      session,
      markdown: '# First\n'
    })

    // Trying to read or edit 2.md using 1.md's session is rejected.
    const crossRead = await runBridge(home, ['read-document', '--session', session, doc2.target])
    expect(crossRead).toMatchObject({ status: 'error', error: 'document-target-changed' })

    const read2 = await runBridge(home, ['read-document', doc2.target])
    const crossEdit = await runBridge(home, ['edit-document'], {
      target: read2.target,
      confirmed: read2.confirmed,
      revision: read2.revision,
      session,
      markdown: '# Hijacked\n'
    })
    expect(crossEdit).toMatchObject({ status: 'error', error: 'document-target-changed' })
    expect(tabs[1].markdown).toBe('# Second\n')

    // Editing 1.md with the session succeeds while 2.md remains active and untouched.
    const edit1 = await runBridge(home, ['edit-document'], {
      target: reread.target,
      confirmed: reread.confirmed,
      revision: reread.revision,
      session,
      markdown: '# First Edited\n'
    })
    expect(edit1).toMatchObject({ status: 'ok' })
    expect(tabs[0].markdown).toBe('# First Edited\n')
    expect(tabs[1].markdown).toBe('# Second\n')

    // Closing 1.md makes the session unavailable instead of falling back to 2.md.
    tabs = tabs.filter(item => item.id !== 'tab-1')
    const afterClose = await runBridge(home, ['read-document', '--session', session])
    expect(afterClose).toMatchObject({ status: 'error', error: 'document-unavailable' })
  })
})
