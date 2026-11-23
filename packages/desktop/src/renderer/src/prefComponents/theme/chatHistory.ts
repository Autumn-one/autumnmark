import type { ThemeChatDiagnostic } from '@shared/localTheme'

export interface ThemeChat {
  id: string
  created: number
  title: string
  draftUuid?: string
}

export interface ThemeTurn {
  id: string
  chatId: string
  position: number
  draftId: string
  prompt: string
  reply: string
  notice?: string
  screenshots: string[]
  diagnostics?: ThemeChatDiagnostic[]
  before: string
  after: string
  sample?: { before: string | null; after: string }
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function openChatHistory() {
  const opening = indexedDB.open('autumnmark.theme-chats', 1)
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore('chats', { keyPath: 'id' })
    opening.result.createObjectStore('turns', { keyPath: ['chatId', 'position'] })
  }
  const db = await result(opening)
  const range = (id: string, from = 0) => IDBKeyRange.bound([id, from], [id, Infinity])
  const write = (update: (chats: IDBObjectStore, turns: IDBObjectStore) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(['chats', 'turns'], 'readwrite', { durability: 'strict' })
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      try {
        update(tx.objectStore('chats'), tx.objectStore('turns'))
      } catch (cause) {
        tx.abort()
        reject(cause)
      }
    })
  return {
    async list(draftUuid: string, selected: string): Promise<ThemeChat[]> {
      const rows = await result<ThemeChat[]>(db.transaction('chats').objectStore('chats').getAll())
      const unassigned = rows.filter(chat => !chat.draftUuid)
      if (unassigned.length) {
        const turns = db.transaction('turns').objectStore('turns')
        // Older chats were shown globally. Keep each history with the draft edited most recently.
        const owners = await Promise.all(unassigned.map(async chat => {
          const cursor = await result(turns.openCursor(range(chat.id), 'prev'))
          const last = cursor?.value as ThemeTurn | undefined
          const owner = typeof last?.draftId === 'string' ? last.draftId.split(':').at(-1) : undefined
          return owner || (chat.id === selected ? draftUuid : undefined)
        }))
        const claimed = unassigned.flatMap((chat, index) => {
          if (!owners[index]) return []
          chat.draftUuid = owners[index]
          return [chat]
        })
        if (claimed.length) await write(chats => claimed.forEach(chat => { chats.put(chat) }))
      }
      return rows.filter(chat => chat.draftUuid === draftUuid).sort((a, b) => b.created - a.created)
    },
    read(id: string): Promise<ThemeTurn[]> {
      return result(db.transaction('turns').objectStore('turns').getAll(range(id)))
    },
    async create(draftUuid: string): Promise<ThemeChat> {
      const chat = { id: crypto.randomUUID(), created: Date.now(), title: '', draftUuid }
      await write(chats => { chats.add(chat) })
      return chat
    },
    // A retry replaces its whole branch in one transaction, including its screenshots.
    save(chat: ThemeChat, turn: ThemeTurn, replaceFrom?: number): Promise<void> {
      return write((chats, turns) => {
        if (replaceFrom !== undefined) turns.delete(range(chat.id, replaceFrom))
        if (turn.position === 0) chats.put({ ...chat, title: turn.prompt.trim().split(/\r?\n/)[0].slice(0, 80) })
        turns.put({ ...turn, screenshots: [...turn.screenshots], diagnostics: turn.diagnostics?.map(entry => ({ ...entry })),
          sample: turn.sample && { ...turn.sample } })
      })
    },
    retract(chat: ThemeChat, from: number): Promise<void> {
      return write((chats, turns) => {
        turns.delete(range(chat.id, from))
        if (!from) chats.put({ ...chat, title: '' })
      })
    },
    remove(...ids: string[]): Promise<void> {
      return write((chats, turns) => {
        for (const id of ids) {
          chats.delete(id)
          turns.delete(range(id))
        }
      })
    },
    close: () => db.close()
  }
}
