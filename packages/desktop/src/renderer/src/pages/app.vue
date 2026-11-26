<template>
  <div class="editor-container">
    <title-bar
      :filename="filename"
      :active="windowActive"
      :platform="platform"
      :is-saved="isSaved"
    />

    <div class="editor-workspace">
      <side-bar
        v-if="init"
        ref="sideBar"
        :read-markdown="readMarkdown"
        :edit-markdown="editMarkdown"
        @theme-preview="setThemePreview"
        @open-history="preferredHistoryType = 'document'"
      />

      <div class="editor-middle">
        <recent v-if="!hasCurrentFile && init" />
        <editor-with-tabs
          v-if="hasCurrentFile && init"
          ref="editorView"
          :markdown="markdown"
          :cursor="cursor"
          :muya-index-cursor="muyaIndexCursor"
          :source-code="sourceCode && !currentFile?.readOnly"
          :show-tab-bar="showTabBar"
          :text-direction="textDirection"
          :platform="platform"
          :can-insert-drawing="id => !!noteForDrawing(id)"
          :insert-drawing="insertDrawing"
        >
          <template
            v-if="activeThemePreview"
            #document-actions
          >
            <button
              type="button"
              class="theme-preview-status"
              @click="openAiChat"
            >
              {{ t('themeAi.previewStatus') }}
            </button>
          </template>
        </editor-with-tabs>
        <el-dialog
          v-if="drawingDialog"
          :model-value="true"
          :title="drawingDialog.title"
          :close-on-press-escape="false"
          :before-close="closeDrawingDialog"
          align-center
          append-to-body
          width="min(92vw, 1200px)"
        >
          <div class="drawing-dialog-canvas">
            <drawing-canvas
              :session="drawingDialog"
              :show-source="drawingDialog.embedded"
              :open-in-tab="promoteDrawingDialog"
              :inserted="() => drawingDialog = null"
            />
          </div>
        </el-dialog>
        <command-palette />
        <about-dialog />
        <export-setting-dialog />
        <application-history
          v-if="preferredHistoryType"
          :preferred-type="preferredHistoryType"
          :target="currentFile ?? undefined"
          @conversation="openHistoryConversation"
          @close="preferredHistoryType = null"
        />
        <rename />
        <import-modal v-model="showImport" />
        <batch-media-dialog
          v-if="batchMediaTarget"
          :target="batchMediaTarget"
          :edit="editMarkdown"
          @close="batchMediaTarget = null"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, watch, nextTick, onMounted, onUnmounted, ref, shallowReactive, shallowRef } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import BatchMediaDialog from '@/components/batchMediaDialog.vue'
import { batchMediaTarget } from '@/contextMenu/batchMedia'
import { applyMarkdownEdits, type EditMarkdown } from '@shared/markdownEdits'
import { t } from '@/i18n'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import AboutDialog from '@/components/about/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import ApplicationHistory from '@/components/history/index.vue'
import Rename from '@/components/rename/index.vue'
import ImportModal from '@/components/import/index.vue'
import bus from '@/bus'
import { DEFAULT_STYLE } from '@/config'
import { useLayoutStore } from '@/store/layout'
import { useListenForMainStore } from '@/store/listenForMain'
import { usePreferencesStore } from '@/store/preferences'
import { getSessionActions, useEditorStore } from '@/store/editor'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useProjectStore } from '@/store/project'
import { useNotificationStore } from '@/store/notification'
import { startWindowSession } from '@/services/windowSession'
import { serveSkillDocuments } from '@/services/skillDocuments'
import { appliedThemeRevisionInput } from '@shared/autumnmarkSkill'
import { videoMime } from '@shared/embeddedImage'
import type { LocalTheme } from '@shared/localTheme'
import { encodeInlineDrawing, findEmbeddedDrawings, imageToMarkdown, inlineDrawingToMarkdown, type IDrawingInsertion, type TDrawingInsertTrace } from '@muyajs/core'
import { drawingDestination, isDrawingPath } from '@/util/drawingPaths'
import notice from '@/services/notification'
import { blankDrawing } from '@shared/drawing'
import type { IFileState } from '@shared/types/files'
import { createDocumentState } from '@/store/help'
import { drawingDialog, drawingEditorTabs, type DrawingEditor } from '@/services/drawingEditors'

const DrawingCanvas = defineAsyncComponent(() => import('@/components/drawingCanvas.vue'))

const mainStore = useMainStore()
const editorView = ref<InstanceType<typeof EditorWithTabs>>()
const readMarkdown = (id: string): string | undefined => editorView.value?.readMarkdown(id)
const editMarkdown: EditMarkdown = (id, prepare, options) => {
  if (!editorView.value) throw new Error(t('batchMedia.changed'))
  editorView.value.editMarkdown(id, prepare, options)
}
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)
const showImport = ref(false)
const sideBar = ref<InstanceType<typeof SideBar>>()
const preferredHistoryType = ref<'document' | 'theme' | null>(null)

const { windowActive, platform, init } = storeToRefs(mainStore)
const { showTabBar } = storeToRefs(layoutStore)
const { sourceCode, theme, customCss, textDirection, zoom } = storeToRefs(preferencesStore)
const { currentFile } = storeToRefs(editorStore)
const lastNote = ref('')
const currentDrawing = computed(() => !!currentFile.value && isDrawingPath(currentFile.value.pathname || currentFile.value.filename))
function noteForDrawing(id: string) {
  const noteId = drawingEditorTabs.get(id)?.noteId ?? lastNote.value
  return editorStore.tabs.find(tab => tab.id === noteId && !tab.readOnly && !tab.modeChanging && !tab.diskConflict)
}
watch(() => currentFile.value?.id, id => {
  if (id && currentDrawing.value) layoutStore.SET_LAYOUT({ showTabBar: true })
  else if (id) lastNote.value = id
}, { immediate: true, flush: 'sync' })
let choosingDrawing = false
let creatingDrawing = false

function editDrawingNote(note: IFileState, prepare: Parameters<EditMarkdown>[1]) {
  if (!editorStore.tabs.some(tab => tab.id === note.id) || note.readOnly || note.modeChanging || note.diskConflict)
    throw new Error(t('drawing.documentUnavailable'))
  if (currentFile.value?.id === note.id) {
    editMarkdown(note.id, prepare, { preventScroll: true })
    editorStore.flushActiveEditor()
    return
  }
  const markdown = applyMarkdownEdits(note.markdown, prepare(note.markdown))
  if (note.markdown === markdown) return
  note.blocks = undefined
  note.history = { stack: [], index: -1 }
  editorStore.LISTEN_FOR_CONTENT_CHANGE({ id: note.id, markdown })
}

function appendDrawing(note: IFileState, block: string) {
  editDrawingNote(note, markdown => [{
    start: markdown.length,
    end: markdown.length,
    text: `${markdown && !markdown.endsWith('\n\n') ? markdown.endsWith('\n') ? '\n' : '\n\n' : ''}${block}\n`
  }])
}

function insertNoteDrawing(note: IFileState, markup: string, target?: IDrawingInsertion, trace?: TDrawingInsertTrace) {
  if (!target) {
    appendDrawing(note, markup)
    return
  }
  editDrawingNote(note, markdown => {
    if (markdown.trimEnd() !== target.markdown.trimEnd()) {
      trace?.('target-markdown-changed')
      throw new Error(t('drawing.insertionChanged'))
    }
    return [{ start: 0, end: markdown.length, text: target.replace(markup) }]
  })
}

const embeddedMarkup = (content: string) => inlineDrawingToMarkdown(content, t('drawing.embedded'))
const comparableScene = (source: string) => source.split('\n').filter(line => line.trim()).join('\n').trim()
const noteMarkdown = (note: IFileState) => readMarkdown(note.id) ?? note.markdown

async function saveDrawingNote(note: IFileState, trace?: TDrawingInsertTrace) {
  if (!note.pathname) {
    const checkpoint = await getSessionActions()?.checkpoint()
    trace?.('draft-checkpoint-result', {
      status: checkpoint?.status ?? 'unavailable',
      ...(checkpoint?.status === 'failed' && { reason: checkpoint.reason })
    })
    if (checkpoint?.status !== 'persisted') throw new Error(t('drawing.documentUnavailable'))
    return
  }
  const result = await getSessionActions()?.save(note.id)
  trace?.('note-save-result', { status: result?.status ?? 'unavailable' })
  if (result?.status !== 'saved') throw new Error(t('drawing.documentUnavailable'))
}

function embeddedDrawingCommit(note: IFileState, source: string, drawing: DrawingEditor, trace?: TDrawingInsertTrace) {
  let previousMarkdown = noteMarkdown(note)
  return async(content: string) => {
    if (source !== content || noteMarkdown(note) !== previousMarkdown) {
      editDrawingNote(note, markdown => {
        const drawings = findEmbeddedDrawings(markdown)
        const expected = comparableScene(source)
        const matches = drawings.filter(({ source }) => source !== undefined && comparableScene(source) === expected)
        const atIndex = drawing.embeddedIndex === undefined ? undefined : drawings[drawing.embeddedIndex]
        const target = markdown.trimEnd() === previousMarkdown.trimEnd() && atIndex && matches.includes(atIndex)
          ? atIndex
          : matches.length === 1 ? matches[0] : undefined
        if (!target) throw new Error(t('drawing.documentUnavailable'))
        drawing.embeddedIndex = drawings.indexOf(target)
        return [{
          start: target.start,
          end: target.end,
          text: target.kind === 'inline' ? encodeInlineDrawing(content)
            : content.split('\n').map(line => target.prefix + line).join('\n') + '\n'
        }]
      })
      source = content
      previousMarkdown = noteMarkdown(note)
    }
    await saveDrawingNote(note, drawing.draft ? trace : undefined)
    return true
  }
}

const drawingTabForPath = (path: string) => editorStore.tabs.find(tab =>
  !drawingEditorTabs.has(tab.id) && tab.pathname && window.fileUtils.isSamePathSync(tab.pathname, path))

function linkedDrawingCommit(path: string, expected: string) {
  return async(content: string) => {
    const tab = drawingTabForPath(path)
    if (tab) {
      editorStore.flushActiveEditor()
      if (tab.readOnly || tab.diskConflict || (tab.markdown !== expected && tab.markdown !== content))
        throw new Error(t('drawing.changedOnDisk'))
      editorStore.UPDATE_DRAWING(tab.id, content)
      const saved = await getSessionActions()?.save(tab.id)
      if (saved?.status !== 'saved') throw new Error(t('drawing.changedOnDisk'))
    } else {
      const result = window.electron.ipcRenderer.invoke('mt::drawing::write', path, content, expected)
      await result
    }
    expected = content
    bus.emit('drawing::preview-changed')
    return true
  }
}

function openDrawingTab(drawing: DrawingEditor) {
  const filename = (title: string) => isDrawingPath(title) ? title : `${title}.excalidraw`
  const file = createDocumentState({ filename: filename(drawing.title), readOnly: drawing.readOnly, trimTrailingNewline: 0 })
  drawingEditorTabs.set(file.id, drawing)
  editorStore.UPDATE_CURRENT_FILE(file)
  const stop = watch(() => [drawingEditorTabs.has(file.id), drawing.title] as const, ([open, title]) => {
    if (!open) stop()
    const tab = editorStore.tabs.find(tab => tab.id === file.id)
    if (tab) tab.filename = filename(title)
  })
}

let closingDrawingDialog = false
async function closeDrawingDialog(done: () => void) {
  const drawing = drawingDialog.value
  if (!drawing || closingDrawingDialog) return
  closingDrawingDialog = true
  try {
    const close = await drawing.beforeClose?.()
    if (close === false || drawingDialog.value !== drawing) return
    done()
    drawingDialog.value = null
  } finally {
    closingDrawingDialog = false
  }
}

async function promoteDrawingDialog() {
  const drawing = drawingDialog.value
  if (!drawing) return
  if (drawing.noteId) openDrawingTab(drawing)
  else if (drawing.pathname) {
    window.electron.ipcRenderer.send('mt::open-file', drawing.pathname, { preview: false })
  } else {
    await getSessionActions()?.create(drawing.source, true, drawing.title)
  }
  drawingDialog.value = null
}

const drawingTitle = () => `${t('drawing.untitled')}.excalidraw`

async function closeDrawingTabForPreview(matches: (drawing: DrawingEditor) => boolean) {
  const existing = [...drawingEditorTabs].find(([, drawing]) => matches(drawing))
  if (!existing) return undefined
  const [id, drawing] = existing
  const close = await drawing.beforeClose?.()
  if (close === false) return false
  const tab = editorStore.tabs.find(tab => tab.id === id)
  if (tab) editorStore.FORCE_CLOSE_TAB(tab)
  drawingEditorTabs.delete(id)
  return drawing
}

async function openEmbeddedDrawing(request: unknown) {
  const { source, index } = request as { source: string; index: number }
  const note = currentFile.value
  if (!note || currentDrawing.value || drawingDialog.value || choosingDrawing) return
  choosingDrawing = true
  try {
    const closed = await closeDrawingTabForPreview(drawing => drawing.noteId === note.id &&
      drawing.embeddedIndex === index && comparableScene(drawing.source) === comparableScene(source))
    if (closed === false || currentFile.value?.id !== note.id) return
    const savedSource = closed?.source ?? source
    const drawing: DrawingEditor = shallowReactive({
      title: t('drawing.embedded'),
      pathname: note.pathname,
      source: savedSource,
      noteId: note.id,
      embedded: true,
      embeddedIndex: index,
      draft: false,
      get readOnly() { return note.readOnly },
      commit: content => commit(content)
    })
    const commit = embeddedDrawingCommit(note, savedSource, drawing)
    drawingDialog.value = drawing
  } finally {
    choosingDrawing = false
  }
}

async function openLinkedDrawing(request: unknown) {
  const { path, noteId } = request as { path: string; noteId: string }
  const note = currentFile.value
  if (!note || note.id !== noteId || drawingDialog.value || choosingDrawing) return
  choosingDrawing = true
  try {
    const closed = await closeDrawingTabForPreview(drawing => !!drawing.pathname &&
      isDrawingPath(drawing.pathname) && window.fileUtils.isSamePathSync(drawing.pathname, path))
    if (closed === false || currentFile.value?.id !== noteId) return
    editorStore.flushActiveEditor()
    const tab = drawingTabForPath(path)
    const source = tab?.markdown ?? await window.fileUtils.readFile(path, 'utf8')
    if (typeof source !== 'string' || currentFile.value?.id !== noteId) return
    drawingDialog.value = shallowReactive({
      title: window.path.basename(path),
      pathname: path,
      source,
      noteId,
      draft: false,
      get readOnly() { return note.readOnly || !!tab?.readOnly },
      commit: linkedDrawingCommit(path, source)
    })
  } catch (reason) {
    void notice.notify({ title: t('drawing.openFailed', { reason: String(reason) }), type: 'error' })
  } finally {
    choosingDrawing = false
  }
}

async function showDrawing(requestedPath?: unknown) {
  if (choosingDrawing) return
  choosingDrawing = true
  const note = currentFile.value
  try {
    const options = {
      title: t('drawing.open'),
      defaultPath: note?.pathname ? window.path.dirname(note.pathname) : undefined,
      filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }]
    }
    const path = typeof requestedPath === 'string' ? requestedPath : await window.electron.dialog.showOpenFile(options)
    if (!path) return
    if (!window.path.isAbsolute(path) || !isDrawingPath(path)) throw new Error(t('drawing.invalidFile'))
    window.electron.ipcRenderer.send('mt::open-file', path, { preview: false })
  } catch (reason) {
    void notice.notify({ title: t('drawing.openFailed', { reason: String(reason) }), type: 'error' })
  } finally {
    choosingDrawing = false
  }
}

function newNoteDrawing(note: IFileState, embed: boolean, target?: IDrawingInsertion, trace?: TDrawingInsertTrace): DrawingEditor {
  let saveAttached: ((content: string) => Promise<boolean>) | undefined
  let linkedFile: { path: string; source: string; save: (content: string) => Promise<boolean> } | undefined
  const drawing: DrawingEditor = shallowReactive({
    title: embed ? t('drawing.embedded') : drawingTitle(),
    pathname: note.pathname,
    source: blankDrawing,
    noteId: note.id,
    embedded: embed,
    draft: true,
    nameOnInsert: !embed,
    filename: '',
    insertionTrace: trace,
    get readOnly() { return note.readOnly },
    async commit(content, filename) {
      const attached = editorStore.tabs.some(tab => tab.id === note.id)
      if (!attached || note.readOnly || note.modeChanging || note.diskConflict) {
        trace?.('commit-document-unavailable', {
          attached, readOnly: !!note.readOnly, modeChanging: !!note.modeChanging, diskConflict: !!note.diskConflict
        })
        throw new Error(t('drawing.documentUnavailable'))
      }
      if (!embed && (!note.pathname || note.isPendingCreation)) {
        const saved = await getSessionActions()?.save(note.id)
        trace?.('initial-note-save-result', { status: saved?.status ?? 'unavailable' })
        if (saved?.status !== 'saved') return false
      }
      if (!saveAttached) {
        if (target && noteMarkdown(note).trimEnd() !== target.markdown.trimEnd()) {
          trace?.('target-markdown-changed')
          throw new Error(t('drawing.insertionChanged'))
        }
        if (embed) {
          insertNoteDrawing(note, embeddedMarkup(content), target, trace)
          trace?.('markdown-updated')
          drawing.embeddedIndex = target?.embeddedIndex ?? findEmbeddedDrawings(noteMarkdown(note)).length - 1
          saveAttached = embeddedDrawingCommit(note, content, drawing, trace)
          drawing.pathname = note.pathname
        } else {
          if (!linkedFile) {
            trace?.('linked-file-create-started')
            const path = await window.electron.ipcRenderer.invoke('mt::drawing::create', note.id, content, filename?.trim() || undefined)
            trace?.('linked-file-created')
            linkedFile = { path, source: content, save: linkedDrawingCommit(path, content) }
          }
          const file = linkedFile
          const { path } = file
          drawing.pathname = path
          drawing.title = window.path.basename(path)
          const alt = window.path.basename(path, window.path.extname(path)).replace(/[[\]]/g, '\\$&')
          const src = drawingDestination(note.pathname, path)
          insertNoteDrawing(note, imageToMarkdown({ src, alt }), target, trace)
          trace?.('markdown-updated')
          saveAttached = async(next) => {
            if (next !== file.source) {
              await file.save(next)
              file.source = next
            }
            if (drawing.draft) await saveDrawingNote(note, trace)
            return true
          }
        }
      }
      const saved = await saveAttached(content)
      if (saved) {
        drawing.draft = false
        drawing.dirtyDraft = false
      }
      return saved
    }
  })
  return drawing
}

function newStandaloneDrawing(title: string): DrawingEditor {
  let expected: string | undefined
  const drawing: DrawingEditor = shallowReactive({
    title,
    source: blankDrawing,
    readOnly: false,
    draft: true,
    async commit(content) {
      const path = drawing.pathname ?? await window.electron.dialog.showSave({
        title: t('menu.file.save'),
        defaultPath: title,
        filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }]
      })
      if (!path) return false
      await window.electron.ipcRenderer.invoke('mt::drawing::write', path, content, expected)
      expected = content
      drawing.pathname = path
      drawing.title = window.path.basename(path)
      drawing.draft = false
      drawing.dirtyDraft = false
      return true
    }
  })
  return drawing
}

async function newDrawing(documentId?: unknown, { insert = false, target, atCaret = true, trace }: {
  insert?: boolean
  target?: IDrawingInsertion
  atCaret?: boolean
  trace?: TDrawingInsertTrace
} = {}) {
  if (creatingDrawing || drawingDialog.value || choosingDrawing) {
    trace?.('drawing-busy', { creatingDrawing, dialogOpen: !!drawingDialog.value, choosingDrawing })
    return
  }
  const note = currentFile.value
  if (typeof documentId === 'string' && note?.id !== documentId) {
    trace?.('active-document-changed', { hasActiveTab: !!note })
    return
  }
  creatingDrawing = true
  try {
    const asTab = preferencesStore.newDrawingView === 'tab'
    const editableNote = note && !note.readOnly && !note.modeChanging && !note.diskConflict && !currentDrawing.value
    if (editableNote && (insert || note.pathname || note.markdown.trim())) {
      const insertion = target ?? (atCaret ? editorView.value?.drawingInsertion(note.id) : undefined)
      const drawing = newNoteDrawing(note, preferencesStore.embedDrawings, insertion, trace)
      if (insert) {
        try {
          trace?.('commit-started', { embedded: preferencesStore.embedDrawings, hasFile: !!note.pathname })
          const inserted = await drawing.commit(drawing.source)
          trace?.('commit-result', { inserted })
          if (!inserted) return
        } catch (reason) {
          trace?.('commit-failed')
          void notice.notify({ title: t('drawing.saveFailed', { reason: String(reason) }), type: 'error' })
        }
      }
      if (asTab) openDrawingTab(drawing)
      else drawingDialog.value = drawing
      trace?.('editor-requested', { asTab, draft: drawing.draft })
      return
    }
    if (insert) {
      trace?.('document-not-editable', {
        hasActiveTab: !!note,
        readOnly: !!note?.readOnly,
        modeChanging: !!note?.modeChanging,
        diskConflict: !!note?.diskConflict,
        isDrawing: currentDrawing.value
      })
      return
    }
    const stem = t('drawing.untitled')
    let title = drawingTitle()
    let number = 2
    while (editorStore.tabs.some(tab => tab.filename === title)) title = `${stem} ${number++}.excalidraw`
    if (asTab) await getSessionActions()?.create(blankDrawing, true, title)
    else drawingDialog.value = newStandaloneDrawing(title)
  } catch (reason) {
    trace?.('editor-request-failed')
    void notice.notify({ title: t('drawing.saveFailed', { reason: String(reason) }), type: 'error' })
  } finally {
    creatingDrawing = false
  }
}
const insertNewDrawing = (request: unknown) => {
  const { id, atCaret } = (request ?? {}) as { id?: string; atCaret?: boolean }
  void newDrawing(id, { insert: true, atCaret })
}
const insertSlashDrawing = (request: unknown) => {
  const { id, target, trace } = request as { id: string; target: IDrawingInsertion; trace?: TDrawingInsertTrace }
  trace?.('request-received')
  void newDrawing(id, { insert: true, target, trace })
}
const openDrawing = (pathname: unknown) => { void showDrawing(pathname) }

async function insertDrawing(id: string, path: string, content?: string): Promise<boolean> {
  const note = noteForDrawing(id)
  if (!note || note.diskConflict || (!path && content === undefined)) return false
  if (!note.pathname || note.isPendingCreation) {
    const saved = await getSessionActions()?.save(note.id)
    if (saved?.status !== 'saved') return false
  }
  const notePath = note.pathname
  if (content !== undefined) {
    const { rebaseDrawingCards } = await import('@/services/drawingScene')
    const source = await rebaseDrawingCards(content, path, notePath)
    if (noteForDrawing(id)?.id !== note.id || note.pathname !== notePath || note.diskConflict) return false
    editorStore.UPDATE_CURRENT_FILE(note)
    await nextTick()
    if (currentFile.value?.id !== note.id || note.readOnly || note.modeChanging || note.diskConflict) return false
    appendDrawing(note, embeddedMarkup(source))
    await saveDrawingNote(note)
    return true
  }
  editorStore.UPDATE_CURRENT_FILE(note)
  await nextTick()
  if (currentFile.value?.id !== note.id || !notePath || note.pathname !== notePath || note.readOnly || note.modeChanging) return false
  const src = drawingDestination(notePath, path)
  const alt = window.path.basename(path, window.path.extname(path)).replace(/[[\]]/g, '\\$&')
  appendDrawing(note, imageToMarkdown({ src, alt }))
  await saveDrawingNote(note)
  return true
}

watch(() => [currentFile.value?.id, currentFile.value?.isSaved] as const, ([id, saved], [previousId, wasSaved]) => {
  if (id && id === previousId && saved && !wasSaved) bus.emit('drawing::preview-changed')
})

watch(
  () => [currentFile.value?.id, currentFile.value?.readOnly],
  () => {
    window.electron.ipcRenderer.send(
      'mt::update-document-mode',
      !!currentFile.value?.readOnly,
      !!currentFile.value && !currentDrawing.value
    )
  },
  { immediate: true }
)

const filename = computed(() => currentFile.value?.filename)
const isSaved = computed(() => currentFile.value?.isSaved)
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

const themePreview = shallowRef<{ theme: LocalTheme; documentId: string; sourceId: string }>()
const activeThemePreview = computed(() => {
  const preview = themePreview.value
  return preview && preview.sourceId === theme.value && preview.documentId === currentFile.value?.id ? preview.theme : undefined
})

function setThemePreview(draft: LocalTheme | null, documentId?: string): void {
  themePreview.value = draft && documentId ? { theme: draft, documentId, sourceId: theme.value } : undefined
}

function openAiChat(): void {
  layoutStore.SET_LAYOUT({ rightColumn: 'documentChat', showSideBar: true })
}

async function openHistoryConversation(chatId: string, turnId: string): Promise<void> {
  preferredHistoryType.value = null
  openAiChat()
  await nextTick()
  await sideBar.value?.showHistoryTurn(chatId, turnId)
}

let renderedThemeState = ''
watch([theme, () => preferencesStore.localThemes, activeThemePreview], ([id, library, preview]) => {
  const renderedId = preview?.id ?? id
  const source = addThemeStyle(renderedId, preview ? [preview] : library)
  renderedThemeState = appliedThemeRevisionInput(renderedId, source)
})

watch(customCss, (value, oldValue) => {
  if (value !== oldValue) {
    addCustomStyle({
      customCss: value
    })
  }
})

watch(zoom, (zoomValue) => {
  bus.emit('mt::window-zoom', zoomValue)
})

function fileDragKind(data: DataTransfer) {
  const items = Array.from(data.items).filter(item => item.kind === 'file')
  if (items.length > 1) return 'document'
  const type = items[0]?.type
  // Explorer can withhold the filename and MIME type until the drop.
  if (!type || type === 'application/octet-stream') return 'unknown'
  return /^(image|video)\//.test(type) ? 'media' : 'document'
}

function handleWindowDragOver(event: DragEvent) {
  if (event.target instanceof Element && event.target.closest('.drawing-canvas')) return
  const data = event.dataTransfer
  if (!data?.types.length) return
  if (data.types.includes('Files')) {
    const kind = fileDragKind(data)
    const overEditor = event.target instanceof Element && event.target.closest('.mu-editor, .source-code')
    event.preventDefault()
    if (kind === 'document') {
      if (timer.value) clearTimeout(timer.value)
      timer.value = setTimeout(() => { showImport.value = false }, 300)
      showImport.value = true
    }
    data.dropEffect = kind === 'media' && overEditor && currentFile.value?.readOnly ? 'none' : 'copy'
  } else if (!data.types.includes('text/uri-list')) {
    event.stopPropagation()
    data.dropEffect = 'none'
  }
}

function handleWindowDrop(event: DragEvent) {
  if (event.target instanceof Element && event.target.closest('.drawing-canvas')) return
  const data = event.dataTransfer
  if (!data?.types.includes('Files')) return
  const items = Array.from(data.items).filter(item => item.kind === 'file')
  const files = data.files.length
    ? Array.from(data.files)
    : items.map(item => item.getAsFile()).filter(file => file !== null)
  if (!files.length) return
  const mediaOnly = files.every(file => /^(image|video)\//.test(file.type) || videoMime(file.name))
  if (mediaOnly && !items.some(item => item.webkitGetAsEntry()?.isDirectory)) {
    if (!(event.target instanceof Element && event.target.closest('.mu-editor, .source-code'))) {
      event.preventDefault()
    }
    return
  }
  const paths = files.map(file => window.electron.webUtils.getPathForFile(file)).filter(Boolean)
  if (paths.length) {
    event.preventDefault()
    event.stopPropagation()
    showImport.value = false
    if (paths.length === 1 && isDrawingPath(paths[0])) {
      openDrawing(paths[0])
      return
    }
    window.electron.ipcRenderer.send('mt::window::drop', paths)
  }
}

let stopSidebarContextMenu: (() => void) | undefined
let stopWindowSession: (() => void) | undefined
let stopEditListener: (() => void) | undefined
let stopViewListener: (() => void) | undefined
let stopSkillDocuments: (() => void) | undefined
let stopAppliedThemeHistory: (() => void) | undefined
onUnmounted(() => {
  bus.off('drawing::new', newDrawing)
  bus.off('drawing::insert', insertNewDrawing)
  bus.off('drawing::insert-at', insertSlashDrawing)
  bus.off('drawing::open', openDrawing)
  bus.off('drawing::open-embedded', openEmbeddedDrawing)
  bus.off('drawing::open-linked', openLinkedDrawing)
  window.removeEventListener('dragover', handleWindowDragOver)
  window.removeEventListener('drop', handleWindowDrop, true)
  if (timer.value) clearTimeout(timer.value)
  stopSidebarContextMenu?.()
  stopWindowSession?.()
  stopEditListener?.()
  stopViewListener?.()
  stopSkillDocuments?.()
  stopAppliedThemeHistory?.()
})

onMounted(async () => {
  stopAppliedThemeHistory = window.electron.ipcRenderer.on('mt::theme::show-active-history', () => { preferredHistoryType.value = 'theme' })
  bus.on('drawing::new', newDrawing)
  bus.on('drawing::insert', insertNewDrawing)
  bus.on('drawing::insert-at', insertSlashDrawing)
  bus.on('drawing::open', openDrawing)
  bus.on('drawing::open-embedded', openEmbeddedDrawing)
  bus.on('drawing::open-linked', openLinkedDrawing)
  const initial = window.marktext?.initialState
  const initialTheme = initial?.theme || DEFAULT_STYLE.theme
  if (initial) preferencesStore.SET_USER_PREFERENCE({ ...initial, theme: initialTheme })
  // The window URL is fixed at creation and can outlive changes to preferences.
  const source = addStyles({
    theme: initialTheme,
    localThemes: preferencesStore.localThemes,
    codeFontFamily: initial?.codeFontFamily ?? DEFAULT_STYLE.codeFontFamily,
    codeFontSize: initial?.codeFontSize ?? DEFAULT_STYLE.codeFontSize,
    hideScrollbar: initial?.hideScrollbar ?? DEFAULT_STYLE.hideScrollbar
  })
  renderedThemeState = appliedThemeRevisionInput(initialTheme, source)

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  stopEditListener = listenForMainStore.LISTEN_FOR_EDIT()
  stopViewListener = listenForMainStore.LISTEN_FOR_VIEW()
  listenForMainStore.LISTEN_FOR_SHOW_DIALOG()
  listenForMainStore.LISTEN_FOR_PANDOC_EXPORT()
  listenForMainStore.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
  projectStore.LISTEN_FOR_UPDATE_PROJECT()
  projectStore.LISTEN_FOR_LOAD_PROJECT()
  stopSidebarContextMenu = projectStore.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
  preferencesStore.ASK_FOR_USER_PREFERENCE()
  editorStore.LISTEN_SCREEN_SHOT()
  editorStore.LISTEN_FOR_READING_MODE()
  editorStore.LISTEN_FOR_SAVE_AS()
  editorStore.LISTEN_FOR_MOVE_TO()
  editorStore.LISTEN_FOR_SAVE()
  editorStore.REGISTER_EDITOR_COMMANDS()
  editorStore.LISTEN_FOR_RENAME()
  editorStore.LISTEN_FOR_SET_LINE_ENDING()
  editorStore.LISTEN_FOR_SET_ENCODING()
  editorStore.LISTEN_FOR_SET_FINAL_NEWLINE()
  editorStore.LISTEN_FOR_NEW_TAB()
  editorStore.LISTEN_FOR_CLOSE_TAB()
  editorStore.LISTEN_FOR_TAB_CYCLE()
  editorStore.LISTEN_FOR_SWITCH_TABS()
  editorStore.LISTEN_FOR_PRINT_SERVICE_CLEARUP()
  editorStore.LISTEN_FOR_EXPORT_SUCCESS()
  editorStore.LISTEN_FOR_FILE_CHANGE()
  editorStore.LISTEN_WINDOW_ZOOM()
  editorStore.LISTEN_FOR_RELOAD_IMAGES()
  editorStore.LISTEN_FOR_CONTEXT_MENU()

  notificationStore.listenForNotification()

  stopWindowSession = await startWindowSession()
  stopSkillDocuments = serveSkillDocuments(editorStore, readMarkdown, editMarkdown, () => renderedThemeState)

  window.addEventListener('dragover', handleWindowDragOver)
  window.addEventListener('drop', handleWindowDrop, true)
})
</script>

<style scoped>
.drawing-dialog-canvas {
  position: relative;
  height: min(75vh, 780px);
}

.editor-container {
  --editorToolbarHeight: 36px;
  display: flex;
  flex-direction: column;
  position: absolute;
  inset: 0;
}
.editor-container .hide {
  z-index: -1;
  opacity: 0;
  position: absolute;
  left: -10000px;
}
.editor-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  /* Translucent sidebar themes need an opaque surface over the window backdrop. */
  background: var(--editorBgColor);
}

.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  position: relative;
}
.theme-preview-status {
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: var(--themeColor10);
  color: var(--themeColor);
  font: inherit;
  cursor: pointer;
}
</style>
