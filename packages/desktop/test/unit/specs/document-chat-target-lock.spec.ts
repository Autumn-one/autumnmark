// @vitest-environment node
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatDocumentTarget, type DocumentChat, type DocumentChatRequest } from '@shared/documentChat'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ id: 1 })
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerDocumentChat } from 'main_renderer/ipc/documentChat'
import { WindowType } from 'main_renderer/windows/base'

describe('document chat first-document lock', () => {
  let root = ''
  let server: Server | undefined
  let baseUrl = ''
  const receivedPrompts: string[] = []

  beforeEach(async() => {
    handlers.clear()
    receivedPrompts.length = 0
    root = mkdtempSync(path.join(tmpdir(), 'autumnmark-doc-chat-lock-'))
    server = createServer(async(req, res) => {
      let body = ''
      for await (const part of req) body += part
      const { messages } = JSON.parse(body) as { messages: { role: string; content: string }[] }
      const raw = messages.at(-1)?.content ?? ''
      const context = raw.startsWith('{') ? JSON.parse(raw) as { request: string; markdown?: string } : { request: raw }
      receivedPrompts.push(context.request)
      let content = 'General answer'
      if (context.request === 'review') {
        content = context.markdown === undefined
          ? JSON.stringify({ read: ['markdown'] })
          : 'Reviewed your document.'
      } else if (context.request === 'edit') {
        content = context.markdown === undefined
          ? JSON.stringify({ read: ['markdown'] })
          : JSON.stringify({ reply: 'Updated heading.', edits: [{ find: '# Doc 1', replace: '# Doc 1 Edited' }] })
      } else if (context.request === 'edit-doc-2') {
        content = context.markdown === undefined
          ? JSON.stringify({ read: ['markdown'] })
          : JSON.stringify({ reply: 'Updated doc 2.', edits: [{ find: '# Doc 2', replace: '# Doc 2 Edited' }] })
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

    const fakeSender = { id: 1, send: vi.fn() }
    const fakeWin = {
      type: WindowType.EDITOR,
      browserWindow: { isDestroyed: () => false, webContents: fakeSender }
    }
    const fakeApp = {
      paths: { userDataPath: root },
      preferences: { getItem: () => '' },
      windowManager: {
        get: () => fakeWin,
        getWindowsByType: () => [{ id: 1, win: fakeWin }]
      }
    }
    registerDocumentChat(fakeApp as never, async() => ({
      baseUrl,
      key: '',
      model: 'test-model',
      requestType: 'chat-completions',
      reasoningEffort: '',
      contextSize: null,
      outputSize: null
    }))
  })

  afterEach(() => {
    server?.closeAllConnections()
    server?.close()
    server = undefined
    rmSync(root, { recursive: true, force: true })
  })

  const fakeEvent = {
    sender: { id: 1, mainFrame: 'main' },
    senderFrame: 'main'
  }
  const invoke = async<T>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing handler ${channel}`)
    return await handler(fakeEvent, ...args) as T
  }

  it('infers legacy bound targets from the earliest turn proposal or effect', () => {
    const target = { id: 'tab-1', pathname: '/tmp/1.md', filename: '1.md' }
    const legacy: DocumentChat = {
      id: 'chat-1',
      title: 'Old chat',
      updatedAt: 1,
      turns: [
        { id: 't1', prompt: 'hi', reply: 'hello' },
        { id: 't2', prompt: 'edit', proposal: { target, baseHash: 'abc', changes: [] } }
      ]
    }
    expect(chatDocumentTarget(legacy)).toEqual(target)
  })

  it('locks a conversation to the first document the model actually sees and rejects switching to another document', async() => {
    const doc1 = { id: 'tab-1', pathname: path.join(root, '1.md'), filename: '1.md', markdown: '# Doc 1\n' }
    const doc2 = { id: 'tab-2', pathname: path.join(root, '2.md'), filename: '2.md', markdown: '# Doc 2\n' }
    const chatId = await invoke<string>('mt::document-chat::new')

    // Turn 1 answers without reading the document, so the conversation stays unbound.
    await invoke('mt::document-chat::send', {
      chatId, profileId: 'p1', prompt: 'hello', document: doc1
    } satisfies DocumentChatRequest)
    let stored = await invoke<DocumentChat>('mt::document-chat::read', chatId)
    expect(stored.target).toBeUndefined()

    // Turn 2 reads doc1 without editing yet; this locks the conversation to doc1.
    await invoke('mt::document-chat::send', {
      chatId, profileId: 'p1', prompt: 'review', document: doc1
    } satisfies DocumentChatRequest)
    stored = await invoke<DocumentChat>('mt::document-chat::read', chatId)
    expect(stored.target).toEqual({ id: doc1.id, pathname: doc1.pathname, filename: doc1.filename })

    // Turn 3 trying to send doc2 into the same conversation is rejected.
    await expect(invoke('mt::document-chat::send', {
      chatId, profileId: 'p1', prompt: 'edit-doc-2', document: doc2
    } satisfies DocumentChatRequest)).rejects.toThrow('documentTargetMismatch')

    // Turn 3 targeting doc1 (even reopened under a new tab id with the same path) succeeds.
    const reopenedDoc1 = { ...doc1, id: 'tab-1-reopened' }
    const turn = await invoke<{ proposal?: { target: { pathname: string } } }>('mt::document-chat::send', {
      chatId, profileId: 'p1', prompt: 'edit', document: reopenedDoc1
    } satisfies DocumentChatRequest)
    expect(turn.proposal?.target.pathname).toBe(doc1.pathname)
    stored = await invoke<DocumentChat>('mt::document-chat::read', chatId)
    expect(stored.target?.id).toBe('tab-1-reopened')

    // Deleting every turn resets the bound target.
    for (const item of stored.turns) {
      await invoke('mt::document-chat::delete', chatId, item.id)
    }
    const cleared = await invoke<DocumentChat>('mt::document-chat::read', chatId)
    expect(cleared.target).toBeUndefined()
  })
})
