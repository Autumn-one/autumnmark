<template>
  <section
    class="document-chat"
    :aria-label="t('documentChat.title')"
  >
    <div
      v-if="profiles.length || chats.length || pending"
      class="chat-toolbar"
    >
      <chat-picker
        :items="chats"
        :current="currentConversation"
        :disabled="!ready || creating || applying"
        :selection-locked="false"
        :title="conversationTitle"
        :remove-disabled="conversationBusy"
        @select="selectChat"
        @remove="removeConversation"
      />
      <button
        type="button"
        :aria-label="t('studio.newChat')"
        :title="t('studio.newChat')"
        :disabled="!ready || creating || applying"
        @click="newChat"
      >
        <Plus aria-hidden="true" />
      </button>
    </div>

    <div
      v-show="profiles.length || chat?.turns.length || pending"
      ref="timeline"
      class="chat-timeline"
      role="log"
      :aria-label="t('studio.conversation')"
    >
      <p v-if="ready && profiles.length && !chat?.turns.length">
        {{ t('documentChat.empty') }}
      </p>
      <div
        v-for="(turn, index) in chat?.turns"
        :key="turn.id"
        class="turn"
        :data-turn-id="turn.id"
      >
        <article
          class="prompt"
          :aria-label="t('studio.user')"
        >
          <p>{{ turn.prompt }}</p>
        </article>
        <article
          class="assistant-message"
          :aria-label="t('studio.assistant')"
        >
          <p v-if="turn.reply || turn.proposal || turn.themeProposal">
            {{ turn.reply || t('studio.updated') }}
          </p>
          <p
            v-if="turn.error"
            :class="{ 'chat-error': turn.error !== 'cancelled' }"
            :role="turn.error === 'cancelled' ? 'status' : 'alert'"
          >
            {{ t(turnError[turn.error]) }}
          </p>
          <p v-if="!turn.reply && !turn.error && !turn.proposal && !turn.themeProposal && !turn.capture && !turn.screenshot">
            {{ t(chat?.inFlight && index === chat.turns.length - 1 ? 'documentChat.waiting' : 'studio.interrupted') }}
          </p>
          <button
            v-if="turn.screenshot"
            type="button"
            class="screenshot"
            :aria-label="t('studio.screenshot', { n: 1 })"
            @click="screenshotViewer?.openImage(turn.screenshot, t('studio.screenshot', { n: 1 }))"
          >
            <img
              :src="turn.screenshot"
              alt=""
            >
          </button>
          <p
            v-else-if="turn.capture === 'failed' || (turn.capture && !pending)"
            class="chat-error"
            role="alert"
          >
            {{ t('ai.previewFailed') }}
          </p>
          <details v-if="turn.proposal">
            <summary>{{ t('documentChat.review', { name: turn.proposal.target.filename }) }}</summary>
            <div
              v-for="change in turn.proposal.changes"
              :key="change.start"
              class="patch"
            >
              <del v-if="change.before">{{ change.before }}</del>
              <ins v-if="change.text">{{ change.text }}</ins>
            </div>
            <p v-if="turn.proposal.applied">
              {{ t('documentChat.applied') }}
            </p>
          </details>
          <div class="turn-actions">
            <button
              v-if="turn.effects?.theme && turn.themeProposal"
              type="button"
              :disabled="pending || applying"
              @click="themePreview?.review(turn.id, turn.themeProposal, turn.profileId)"
            >
              {{ t('themeAi.viewChange') }}
            </button>
            <button
              v-if="hasAppliedChanges(turn)"
              type="button"
              class="undo-changes"
              :disabled="pending || applying"
              @click="undoTurn(turn)"
            >
              <RefreshLeft aria-hidden="true" />
              {{ t('documentChat.undoChanges') }}
            </button>
            <span
              v-else-if="turn.effects?.markdown === null || turn.effects?.theme === null"
              class="reverted-status"
              role="status"
            >
              {{ t('documentChat.changesReverted') }}
            </span>
            <el-dropdown
              class="turn-menu"
              trigger="click"
              placement="bottom-end"
              :disabled="pending || applying"
              @command="deleteTurn(turn)"
            >
              <button
                type="button"
                :aria-label="t('documentChat.turnActions')"
                :disabled="pending || applying"
              >
                <MoreFilled aria-hidden="true" />
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="delete">
                    {{ t('documentChat.deleteTurn') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </article>
      </div>
    </div>

    <theme-preview
      :key="target.draft.id.split(':')[2]"
      ref="themePreview"
      :source-id="theme"
      :source="source"
      :target="target"
      :document-id="editor.currentFile?.id"
      :pending="pending"
      @preview="(draft, documentId) => emit('theme-preview', draft, documentId)"
    />

    <document-chat-onboarding
      v-if="!profiles.length && !pending"
      :model-state="modelState"
      :class="{ 'after-history': chat?.turns.length }"
      @retry="loadModels"
    />
    <form
      v-else
      class="chat-composer"
      @submit.prevent="send"
    >
      <textarea
        ref="composer"
        v-model="draft"
        :aria-label="t('documentChat.message')"
        :placeholder="t('documentChat.message')"
        :maxlength="maxDocumentChatPromptLength"
        :disabled="creating"
        rows="2"
        @keydown.enter="composerEnter"
      />
      <div class="composer-actions">
        <select
          v-if="profiles.length"
          v-model="profileId"
          :aria-label="t('ai.model')"
        >
          <option
            v-for="model in profiles"
            :key="model.id"
            :value="model.id"
          >
            {{ model.displayName || model.model }}
          </option>
        </select>
        <button
          v-if="sending.has(selectedId)"
          type="button"
          class="composer-action"
          :aria-label="t('studio.stop')"
          :title="t('studio.stop')"
          @click="stop"
        >
          <span class="stop-icon" aria-hidden="true" />
        </button>
        <button
          v-else
          type="submit"
          class="composer-action"
          :aria-label="t('studio.send')"
          :title="t('studio.send')"
          :disabled="!canSend"
        >
          <Top aria-hidden="true" />
        </button>
      </div>
    </form>
    <p
      v-if="error"
      class="chat-error panel-error"
      role="alert"
    >
      {{ t(error) }}
    </p>
    <media-viewer ref="screenshotViewer" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { MoreFilled, Plus, RefreshLeft, Top } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { AiModelProfile } from '@shared/aiModel'
import {
  chatDocumentTarget, maxDocumentChatPromptLength, type DocumentChat,
  type DocumentChatDocument, type DocumentChatEffects, type DocumentChatMarkdownEffect, type DocumentChatProposal,
  type DocumentChatSummary, type DocumentChatTarget, type DocumentChatThemeEffect, type DocumentChatTurn
} from '@shared/documentChat'
import { applyMarkdownEdits, type EditMarkdown } from '@shared/markdownEdits'
import { reverseTextChange, textChanges } from '@shared/reversibleText'
import { isDrawingPath } from '@shared/drawing'
import type { LocalTheme } from '@shared/localTheme'
import type { IFileState } from '@shared/types/files'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import MediaViewer from '@/components/mediaViewer/index.vue'
import ChatPicker from '@/prefComponents/theme/chatPicker.vue'
import DocumentChatOnboarding from './documentChatOnboarding.vue'
import ThemePreview from './themePreview.vue'
import { useEditorThemeTarget } from './useEditorThemeTarget'

const props = defineProps<{
  readMarkdown: (id: string) => string | undefined
  editMarkdown: EditMarkdown
}>()
const emit = defineEmits<{ 'theme-preview': [theme: LocalTheme | null, documentId?: string] }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const editor = useEditorStore()
const preferences = usePreferencesStore()
const { theme, source, target } = useEditorThemeTarget()
const themePreview = ref<InstanceType<typeof ThemePreview>>()
const chats = shallowRef<DocumentChatSummary[]>([])
const chat = shallowRef<(DocumentChat & { inFlight: boolean }) | null>(null)
const selectedId = ref('')
const profiles = shallowRef<AiModelProfile[]>([])
const modelState = ref<'loading' | 'ready' | 'failed'>('loading')
const ready = ref(false)
const creating = ref(false)
const applying = ref(false)
const error = ref('')
const screenshotViewer = ref<InstanceType<typeof MediaViewer>>()
const timeline = ref<HTMLDivElement>()
const composer = ref<HTMLTextAreaElement>()
const sending = reactive(new Set<string>())
const prompts = reactive(new Map<string, string>())
const modelChoices = reactive(new Map<string, string>())
const turnError: Record<NonNullable<DocumentChatTurn['error']>, string> = {
  requestFailed: 'studio.requestFailed',
  configureFirst: 'studio.configureFirst',
  contextTooSmall: 'documentChat.contextTooSmall',
  documentTooLarge: 'documentChat.documentTooLarge',
  invalidEdits: 'documentChat.invalidEdits',
  invalidThemeEdits: 'documentChat.invalidThemeEdits',
  cancelled: 'studio.stopped'
}

function isEditableTab(tab: IFileState | null | undefined): tab is IFileState {
  return !!tab && !tab.readOnly && !tab.modeChanging && !tab.diskConflict && !isDrawingPath(tab.pathname || tab.filename)
}

function sameTarget(a: DocumentChatTarget, b: DocumentChatTarget): boolean {
  return a.id === b.id || (!!a.pathname && !!b.pathname && window.fileUtils.isSamePathSync(a.pathname, b.pathname))
}

function findTab(target: DocumentChatTarget): IFileState | undefined {
  return editor.tabs.find(file => sameTarget(file, target))
}

const editableTab = computed(() => isEditableTab(editor.currentFile) ? editor.currentFile : undefined)
const boundTarget = computed(() => chatDocumentTarget(chat.value))
const profileId = computed({
  get() {
    const id = modelChoices.get(selectedId.value) ?? chat.value?.profileId
    return profiles.value.find(model => model.id === id)?.id ?? profiles.value[0]?.id ?? ''
  },
  set(id: string) { modelChoices.set(selectedId.value, id) }
})
const draft = computed({
  get: () => prompts.get(selectedId.value) ?? '',
  set: (value: string) => { prompts.set(selectedId.value, value) }
})
const canSend = computed(() => ready.value && !creating.value && !sending.has(selectedId.value) &&
  !applying.value && (!selectedId.value || (chat.value?.id === selectedId.value && !chat.value.inFlight)) && !!profileId.value && !!draft.value.trim())
const pending = computed(() => sending.has(selectedId.value) || !!chat.value?.inFlight)
const currentConversation = computed(() => chats.value.find(item => item.id === selectedId.value))
const conversationTitle = (item: DocumentChatSummary) => item.title || t('studio.newChat')
const conversationBusy = (item: DocumentChatSummary) => sending.has(item.id) || (item.id === selectedId.value && pending.value)
const hasAppliedChanges = (turn: DocumentChatTurn) => !!(turn.effects?.markdown || turn.effects?.theme || turn.proposal?.applied)

watch(selectedId, () => {
  themePreview.value?.clearPreview()
  screenshotViewer.value?.close()
}, { flush: 'sync' })
watch([selectedId, () => editableTab.value?.id, () => editableTab.value?.pathname], () => {
  error.value = ''
}, { flush: 'sync' })
watch(() => {
  const last = chat.value?.turns.at(-1)
  return [chat.value?.id, last?.id, last?.reply, last?.proposal?.baseHash, last?.themeProposal?.css, last?.screenshot, last?.error]
}, (_current, previous) => {
  if (timeline.value && previous) timeline.value.scrollTop = timeline.value.scrollHeight
}, { flush: 'post' })

let refreshVersion = 0
async function refresh(): Promise<void> {
  const version = ++refreshVersion
  try {
    const list = await ipc.invoke('mt::document-chat::list')
    const id = list.some(item => item.id === selectedId.value) ? selectedId.value : list[0]?.id
    const current = id ? await ipc.invoke('mt::document-chat::read', id) : null
    if (version !== refreshVersion) return
    chats.value = list
    selectedId.value = current?.id ?? ''
    chat.value = current
    ready.value = true
  } catch {
    if (version === refreshVersion) error.value = 'studio.historyError'
  }
}

async function selectChat(id: string): Promise<void> {
  selectedId.value = id
  chat.value = null
  await refresh()
}

async function showHistoryTurn(chatId: string, turnId: string): Promise<void> {
  await selectChat(chatId)
  await nextTick()
  const turn = timeline.value?.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`)
  const details = turn?.querySelector('details')
  if (!details) return
  details.open = true
  details.querySelector('summary')?.focus()
  details.scrollIntoView({ block: 'nearest' })
}

defineExpose({ showHistoryTurn })

async function newChat(): Promise<string | undefined> {
  if (creating.value) return
  creating.value = true
  let id: string | undefined
  try {
    id = await ipc.invoke('mt::document-chat::new')
    await selectChat(id)
  } catch {
    error.value = 'studio.historyError'
  } finally {
    creating.value = false
  }
  if (id) {
    await nextTick()
    composer.value?.focus()
  }
  return id
}

function matchesTarget(target: DocumentChatTarget): boolean {
  const tab = editableTab.value
  if (!tab) return false
  return target.pathname
    ? !!tab.pathname && window.fileUtils.isSamePathSync(tab.pathname, target.pathname)
    : tab.id === target.id && !tab.pathname
}

function composerEnter(event: KeyboardEvent): void {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat) void send()
}

async function readTargetDocument(target: DocumentChatTarget): Promise<DocumentChatDocument | undefined> {
  const tab = findTab(target)
  if (!tab) {
    if (!target.pathname) return
    try {
      const { markdown } = await ipc.invoke('mt::media::read-document', target.pathname, preferences.autoGuessEncoding)
      return { id: target.id, filename: target.filename, pathname: target.pathname, markdown }
    } catch {
      return
    }
  }
  if (!isEditableTab(tab)) return
  const previous = editor.currentFile
  if (previous?.id !== tab.id) {
    editor.UPDATE_CURRENT_FILE(tab)
    await nextTick()
  }
  try {
    const markdown = props.readMarkdown(tab.id)
    if (markdown === undefined) return
    return { id: tab.id, filename: tab.filename, pathname: tab.pathname, markdown }
  } finally {
    if (previous && previous.id !== tab.id && editor.currentFile?.id === tab.id && editor.tabs.some(file => file.id === previous.id)) {
      editor.UPDATE_CURRENT_FILE(previous)
      await nextTick()
    }
  }
}

async function send(): Promise<void> {
  if (!canSend.value) return
  error.value = ''
  const prompt = draft.value.trim()
  const model = profileId.value
  const initialId = selectedId.value
  const locked = initialId ? boundTarget.value : undefined
  let document: DocumentChatDocument | undefined
  let documentId: string | undefined
  if (locked) {
    sending.add(initialId)
    try {
      document = await readTargetDocument(locked)
    } finally {
      sending.delete(initialId)
    }
    if (selectedId.value !== initialId) return
    documentId = editor.currentFile && sameTarget(locked, editor.currentFile) ? editor.currentFile.id : undefined
  } else {
    const tab = editableTab.value
    documentId = editor.currentFile?.id
    if (tab) {
      const { id, filename, pathname } = tab
      const markdown = props.readMarkdown(id)
      if (markdown !== undefined) {
        document = { id, filename, pathname, markdown }
      }
    }
  }

  const firstMessage = !selectedId.value
  const id = selectedId.value || await newChat()
  if (!id) return
  if (firstMessage) prompts.delete('')
  if (!locked && (documentId !== editor.currentFile?.id || (document && !matchesTarget(document)))) {
    prompts.set(id, prompt)
    error.value = 'documentChat.changed'
    return
  }
  sending.add(id)
  prompts.delete(id)
  const preview = themePreview.value
  try {
    const turn = await ipc.invoke('mt::document-chat::send', {
      chatId: id, profileId: model, prompt, document, previewDocumentId: documentId, theme: preview?.getContext()
    })
    await applyReply(id, turn, preview, model, document?.markdown)
    if (turn.capture && selectedId.value === id && documentId && documentId === editor.currentFile?.id) {
      await nextTick()
      await ipc.invoke('mt::document-chat::capture', id, turn.id).catch(() => {
        if (selectedId.value === id) error.value = 'ai.previewFailed'
      })
    }
  } catch (reason) {
    if (!prompts.has(id)) prompts.set(id, prompt)
    if (selectedId.value === id) {
      error.value = reason instanceof Error && reason.message.includes('documentTargetMismatch')
        ? 'documentChat.changed'
        : 'documentChat.sendFailed'
    }
  } finally {
    sending.delete(id)
  }
}

async function stop(): Promise<void> {
  const id = selectedId.value
  if (!sending.has(id)) return
  try { await ipc.invoke('mt::document-chat::stop', id) }
  catch { if (selectedId.value === id) error.value = 'studio.requestFailed' }
}

async function markdownHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function changeDocument(target: DocumentChatTarget, transform: (markdown: string) => Promise<string>): Promise<DocumentChatMarkdownEffect> {
  const tab = findTab(target)
  if (!tab) {
    if (!target.pathname) throw new Error('Document unavailable')
    const encoding = preferences.autoGuessEncoding
    const { markdown: before, hash } = await ipc.invoke('mt::media::read-document', target.pathname, encoding)
    const after = await transform(before)
    if (after !== before) {
      const result = await ipc.invoke('mt::media::update-document', target.pathname, encoding, hash, textChanges(before, after))
      if (result !== 'saved') throw new Error('Document changed')
    }
    return { target, before, after }
  }
  if (tab.readOnly || tab.modeChanging || tab.diskConflict || isDrawingPath(tab.pathname || tab.filename)) throw new Error('Document unavailable')
  const previous = editor.currentFile
  if (previous?.id !== tab.id) {
    editor.UPDATE_CURRENT_FILE(tab)
    await nextTick()
  }
  try {
    const before = props.readMarkdown(tab.id)
    if (before === undefined) throw new Error('Document unavailable')
    const after = await transform(before)
    if (after !== before) {
      props.editMarkdown(tab.id, live => {
        if (live !== before) throw new Error('Document changed')
        return textChanges(before, after)
      })
    }
    return { target: { id: tab.id, pathname: tab.pathname, filename: tab.filename }, before,
      after: props.readMarkdown(tab.id) ?? after }
  } finally {
    if (previous && previous.id !== tab.id && editor.currentFile?.id === tab.id && editor.tabs.some(file => file.id === previous.id)) {
      editor.UPDATE_CURRENT_FILE(previous)
      await nextTick()
    }
  }
}

async function recordApplied(id: string, turnId: string, effects: DocumentChatEffects, rollback: () => Promise<unknown>) {
  try {
    await ipc.invoke('mt::document-chat::effects', id, turnId, effects)
  } catch (reason) {
    await rollback()
    throw reason
  }
}

async function applyReply(id: string, turn: DocumentChatTurn, preview: typeof themePreview.value, model: string, sentMarkdown?: string): Promise<void> {
  const proposal = turn.proposal
  if (proposal) {
    try {
      const effect = await changeDocument(proposal.target, async before => {
        const original = sentMarkdown ?? before
        if (await markdownHash(original) !== proposal.baseHash) throw new Error('Document changed')
        const after = applyMarkdownEdits(original, proposal.changes)
        const [change] = proposal.changes
        if (proposal.changes.length === 1 && change.start === 0 && change.end === original.length) {
          if (before !== original) throw new Error('Document changed')
          return after
        }
        const merged = reverseTextChange(before, after, original)
        if (merged === null) throw new Error('Document changed')
        return merged
      })
      await recordApplied(id, turn.id, { markdown: effect }, () => revertMarkdown(effect))
    } catch {
      if (selectedId.value === id) error.value = 'documentChat.changed'
    }
  }
  if (turn.themeProposal) {
    try {
      const effect = await preview?.applyProposal(turn.id, turn.themeProposal, model)
      if (!effect) throw new Error('Theme changed')
      await recordApplied(id, turn.id, { theme: effect }, () => revertTheme(effect))
    } catch {
      if (selectedId.value === id) error.value = 'themeAi.changed'
    }
  }
}

async function revertLegacy(current: string, proposal: DocumentChatProposal): Promise<string> {
  let shift = 0
  const edits = proposal.changes.map(change => {
    const start = change.start + shift
    const end = start + change.text.length
    if (current.slice(start, end) !== change.text) throw new Error('Document changed')
    shift += change.text.length - change.before.length
    return { start, end, text: change.before }
  })
  const before = applyMarkdownEdits(current, edits)
  if (await markdownHash(before) !== proposal.baseHash) throw new Error('Document changed')
  return before
}

function revertMarkdown(effect: DocumentChatMarkdownEffect) {
  return changeDocument(effect.target, async current => {
    const reverted = reverseTextChange(current, effect.before, effect.after)
    if (reverted === null) throw new Error('Document changed')
    return reverted
  })
}

async function revertTheme(effect: DocumentChatThemeEffect) {
  const reverted = await ipc.invoke('mt::document-chat::revert-theme', effect)
  if (!reverted) throw new Error('Theme changed')
}

async function revertTurn(id: string, turn: DocumentChatTurn): Promise<void> {
  const { markdown, theme } = turn.effects ?? {}
  if (markdown) {
    await revertMarkdown(markdown)
    await ipc.invoke('mt::document-chat::effects', id, turn.id, { markdown: null })
  } else if (turn.proposal?.applied) {
    const proposal = turn.proposal
    await changeDocument(proposal.target, current => revertLegacy(current, proposal))
    await ipc.invoke('mt::document-chat::effects', id, turn.id, { markdown: null })
  }
  if (theme) {
    await revertTheme(theme)
    await ipc.invoke('mt::document-chat::effects', id, turn.id, { theme: null })
  }
}

async function updateHistory(operation: () => Promise<void>, failure = 'studio.historyError'): Promise<void> {
  if (applying.value) return
  applying.value = true
  error.value = ''
  try {
    await operation()
    await refresh()
  } catch {
    await refresh()
    error.value = failure
  } finally { applying.value = false }
}

async function undoTurn(turn: DocumentChatTurn): Promise<void> {
  const id = chat.value?.id
  if (!id || pending.value || !hasAppliedChanges(turn)) return
  await updateHistory(() => revertTurn(id, turn), 'documentChat.revertFailed')
}

async function deleteTurn(turn: DocumentChatTurn): Promise<void> {
  const id = chat.value?.id
  if (!id || pending.value) return
  await updateHistory(() => ipc.invoke('mt::document-chat::delete', id, turn.id))
}

async function removeConversation(item: DocumentChatSummary): Promise<void> {
  if (conversationBusy(item)) return
  await updateHistory(async() => {
    await ipc.invoke('mt::document-chat::delete', item.id)
    prompts.delete(item.id)
    modelChoices.delete(item.id)
  })
}

const stopHistory = ipc.on('mt::document-chat::changed', () => { void refresh() })
const stopModels = ipc.on('mt::ai::changed', (_event, list) => {
  profiles.value = list
  modelState.value = 'ready'
})
async function loadModels(): Promise<void> {
  modelState.value = 'loading'
  try {
    const list = await ipc.invoke('mt::ai::list')
    if (modelState.value === 'loading') {
      profiles.value = list
      modelState.value = 'ready'
    }
  } catch {
    if (modelState.value === 'loading') modelState.value = 'failed'
  }
}
onMounted(() => {
  void refresh()
  void loadModels()
})
onUnmounted(() => {
  refreshVersion++
  stopHistory()
  stopModels()
})
</script>

<style scoped>
.document-chat { display: flex; flex-direction: column; height: 100%; font-size: 13px; }
.chat-toolbar { display: flex; gap: 6px; align-items: center; padding: 8px; }
.chat-toolbar svg { display: block; width: 14px; height: 14px; }
.chat-timeline { flex: 1; min-height: 0; overflow: auto; padding: 0 8px; user-select: text; }
.after-history { max-height: 65%; border-top: 1px solid var(--editorColor10); }
.chat-timeline p, .chat-error { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.chat-timeline > p { padding: 8px; color: var(--editorColor70); }
.turn { display: grid; gap: 8px; padding: 8px 2px; border-bottom: 1px solid var(--editorColor10); }
.prompt, .assistant-message { min-width: 0; max-width: 90%; box-sizing: border-box; padding: 8px; border-radius: 8px; }
.prompt { justify-self: right; background: var(--themeColor10); }
.chat-toolbar button {
  display: grid;
  place-items: center;
  width: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--editorColor70);
  background: transparent;
}
.chat-toolbar button:enabled:hover { color: var(--editorColor); background: var(--editorColor10); border-color: transparent; }
.assistant-message { justify-self: left; display: grid; gap: 8px; background: var(--editorColor04); }
.screenshot { justify-self: start; max-width: 100%; }
.screenshot img { display: block; width: auto; height: auto; max-width: 100%; max-height: 88px; }
details { padding: 6px; border: 1px solid var(--editorColor20); border-radius: 6px; }
details > :not(summary) { margin-top: 6px; }
summary { cursor: pointer; overflow-wrap: anywhere; }
.patch :is(ins, del) { display: block; padding: 5px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: monospace; text-decoration: none; }
.patch ins { background: var(--themeColor10); border-inline-start: 2px solid var(--themeColor); }
.patch del { background: color-mix(in srgb, var(--deleteColor) 10%, transparent); border-inline-start: 2px solid var(--deleteColor); text-decoration: line-through; }
.composer-actions, .turn-actions { display: flex; align-items: center; gap: 6px; }
.turn-actions { flex-wrap: wrap; }
.turn-actions button { display: inline-flex; align-items: center; gap: 4px; }
.turn-actions svg { width: 13px; height: 13px; flex: none; }
.turn-menu { margin-inline-start: auto; }
.turn-menu button { padding: 0 5px; min-height: 24px; border-color: transparent; background: transparent; }
.reverted-status { color: var(--editorColor70); }
button, :deep(.preview-actions button) { color: inherit; font: inherit; background: var(--editorBgColor); border: 1px solid var(--editorColor20); border-radius: 5px; padding: 4px 6px; min-height: 28px; }
button:enabled, :deep(.preview-actions button:enabled) { cursor: pointer; }
button:enabled:hover, :deep(.preview-actions button:enabled:hover) { border-color: var(--themeColor); }
button:disabled, :deep(.preview-actions button:disabled) { opacity: .5; }
.chat-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 0 10px 8px;
  padding: 10px;
  border: 1px solid var(--editorColor20);
  border-radius: 12px;
  color: var(--editorColor);
  background: var(--editorBgColor);
}
.chat-composer:focus-within { border-color: var(--themeColor); }
.chat-composer textarea {
  field-sizing: content;
  display: block;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: calc(2lh + 4px);
  max-block-size: 20vh;
  padding: 2px 0;
  border: 0;
  outline: none;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: 1.5;
  resize: none;
}
.chat-composer textarea::placeholder { color: var(--editorColor60); }
.composer-actions select {
  field-sizing: content;
  min-inline-size: 0;
  block-size: 28px;
  padding-inline: 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: inherit;
  background: color-mix(in srgb, var(--editorBgColor), var(--sideBarBgColor) 82%);
  font: inherit;
  cursor: pointer;
}
.composer-actions select:hover { background: color-mix(in srgb, var(--sideBarBgColor), var(--editorColor) 8%); }
.composer-actions :is(select, button):focus-visible { outline: 2px solid var(--themeColor); outline-offset: 2px; }
.composer-action {
  display: grid;
  flex: none;
  place-items: center;
  inline-size: 32px;
  block-size: 32px;
  margin-inline-start: auto;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--buttonPrimaryFontColor);
  background: var(--buttonPrimaryBgColor);
}
.composer-action:enabled:hover { border-color: transparent; color: var(--buttonPrimaryFontColorHover); background: var(--buttonPrimaryBgColorHover); }
.composer-action:disabled { color: var(--editorColor60); background: var(--editorColor10); opacity: 1; }
.composer-action svg { inline-size: 16px; block-size: 16px; }
.stop-icon { inline-size: 10px; block-size: 10px; border-radius: 2px; background: currentColor; }
.chat-error { color: var(--deleteColor); }
.panel-error { padding: 0 8px 8px; }
</style>
