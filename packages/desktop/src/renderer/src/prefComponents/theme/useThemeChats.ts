import { computed, ref, shallowRef, watch } from 'vue'
import { openChatHistory, type ThemeChat, type ThemeTurn } from './chatHistory'
import { isCancelledRequest } from './studioErrors'

export function useThemeChats(selectionKey: string, draftUuid: string, t: (key: string) => string) {
  const chats = ref<ThemeChat[]>([])
  const selected = ref(localStorage.getItem(selectionKey) ?? '')
  const turns = ref<ThemeTurn[]>([])
  const ready = ref(false)
  const currentAction = shallowRef<Promise<void>>()
  const currentRemoval = shallowRef<Promise<void>>()
  const removing = computed(() => !!currentRemoval.value)
  const working = computed(() => !!currentAction.value || removing.value)
  const storageError = ref('')
  const draftKey = (id: string) => selectionKey + '.input.' + id
  const prompt = ref(sessionStorage.getItem(draftKey(selected.value)) ?? '')
  watch(prompt, value => {
    try {
      if (value) sessionStorage.setItem(draftKey(selected.value), value)
      else sessionStorage.removeItem(draftKey(selected.value))
    } catch { storageError.value = t('studio.historyError') }
  }, { flush: 'sync' })
  const chat = computed(() => chats.value.find(item => item.id === selected.value))
  const changes = new BroadcastChannel('autumnmark.theme-chats')
  let archive: Awaited<ReturnType<typeof openChatHistory>>
  let selectionVersion = 0
  let refreshPending = false
  let closed = false

  async function select(id: string): Promise<void> {
    const version = ++selectionVersion
    ready.value = false
    try {
      const list = await archive.list(draftUuid, selected.value)
      const next = list.find(item => item.id === id) ?? list[0]
      const history = next ? await archive.read(next.id) : []
      if (version !== selectionVersion) return
      if (selected.value !== (next?.id ?? '')) {
        if (selected.value && !list.some(item => item.id === selected.value)) {
          sessionStorage.removeItem(draftKey(selected.value))
          if (!next) sessionStorage.removeItem(draftKey(''))
        }
        selected.value = next?.id ?? ''
        prompt.value = sessionStorage.getItem(draftKey(selected.value)) ?? ''
      }
      chats.value = list
      for (const turn of history) {
        const last = turn.diagnostics?.at(-1)
        if (last?.requestId === turn.id && isCancelledRequest(last.reason)) {
          if (turn.notice || (turn.reply && turn.reply !== t('studio.requestFailed'))) turn.notice = t('studio.interrupted')
          else turn.reply = t('studio.interrupted')
        }
        if (turn.diagnostics) turn.diagnostics = turn.diagnostics.filter(entry => !isCancelledRequest(entry.reason))
      }
      turns.value = history
      if (selected.value) localStorage.setItem(selectionKey, selected.value)
      else localStorage.removeItem(selectionKey)
      ready.value = true
    } catch {
      storageError.value = t('studio.historyError')
    }
  }
  changes.onmessage = () => {
    if (working.value) refreshPending = true
    else if (archive) void select(selected.value)
  }
  async function open(): Promise<void> {
    try {
      const opened = await openChatHistory()
      if (closed) { opened.close(); return }
      archive = opened
      await select(selected.value)
    } catch {
      storageError.value = t('studio.historyError')
    }
  }
  async function create(): Promise<void> {
    const item = await archive.create(draftUuid)
    await select(item.id)
    changes.postMessage(item.id)
  }
  async function runAction(action: () => Promise<void>, removingOtherChat = false): Promise<void> {
    if (!ready.value || removing.value || (working.value && !removingOtherChat)) return
    const pending = removingOtherChat ? currentRemoval : currentAction
    storageError.value = ''
    pending.value = Promise.resolve().then(action)
      .catch(() => { storageError.value = t('studio.historyError') })
      .finally(() => {
        pending.value = undefined
        if (!working.value && refreshPending) {
          refreshPending = false
          void select(selected.value)
        }
      })
    await pending.value
  }
  // Each studio has its own theme draft, but multiple windows may open the same saved chat.
  async function lockChat(id: string, action: () => Promise<void>): Promise<void> {
    await navigator.locks.request('autumnmark.theme-chat.' + id, { ifAvailable: true }, async lock => {
      if (!lock) { storageError.value = t('studio.chatChanged'); return }
      await action()
      changes.postMessage(id)
    })
  }
  function withChat(action: (item: ThemeChat) => Promise<void>): Promise<void> {
    return runAction(async() => {
      if (!chat.value) await create()
      const item = chat.value
      if (!item) return
      await lockChat(item.id, async() => {
        const last = turns.value.at(-1)?.id
        await select(item.id)
        if (!ready.value) return
        if (selected.value !== item.id || turns.value.at(-1)?.id !== last) {
          storageError.value = t('studio.chatChanged')
          return
        }
        await action(item)
      })
    })
  }
  function remove(item: ThemeChat): Promise<void> {
    const removingOtherChat = item.id !== selected.value
    return runAction(() => lockChat(item.id, async() => {
      await archive.remove(item.id)
      // Reloading the selected chat would replace the turn receiving live updates.
      if (removingOtherChat) chats.value = chats.value.filter(chat => chat.id !== item.id)
      else await select(selected.value)
      sessionStorage.removeItem(draftKey(item.id))
    }), removingOtherChat)
  }
  async function save(item: ThemeChat, turn: ThemeTurn, replaceFrom?: number): Promise<void> {
    await archive.save(item, turn, replaceFrom)
    if (!turn.position) item.title = turn.prompt.trim().split(/\r?\n/)[0].slice(0, 80)
    if (chat.value?.id === item.id) chat.value.title = item.title
  }
  async function retract(item: ThemeChat, from: number): Promise<void> {
    await archive.retract(item, from)
    turns.value.splice(from)
    if (!from && chat.value) chat.value.title = ''
  }
  function close(): void {
    closed = true
    selectionVersion++
    changes.close()
    archive?.close()
  }
  async function whenIdle(): Promise<void> {
    await Promise.all([currentAction.value, currentRemoval.value])
  }
  return { chats, chat, selected, turns, ready, working, removing, storageError, prompt, open, select, newChat: () => runAction(create),
    whenIdle, withChat, save, remove, retract, close }
}
