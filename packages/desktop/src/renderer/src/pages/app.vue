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
          :can-insert-drawing="!!insertionNote"
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
import { computed, watch, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import BatchMediaDialog from '@/components/batchMediaDialog.vue'
import { batchMediaTarget } from '@/contextMenu/batchMedia'
import type { EditMarkdown } from '@shared/markdownEdits'
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
import { imageToMarkdown } from '@muyajs/core'
import { drawingDestination, isDrawingPath } from '@/util/drawingPaths'
import notice from '@/services/notification'
import { blankDrawing } from '@shared/drawing'

const mainStore = useMainStore()
const editorView = ref<InstanceType<typeof EditorWithTabs>>()
const readMarkdown = (id: string): string | undefined => editorView.value?.readMarkdown(id)
const editMarkdown: EditMarkdown = (id, prepare) => {
  if (!editorView.value) throw new Error(t('batchMedia.changed'))
  editorView.value.editMarkdown(id, prepare)
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
const insertionNote = computed(() => editorStore.tabs.find(tab => tab.id === lastNote.value && !tab.readOnly && !tab.modeChanging))
watch(() => currentFile.value?.id, id => {
  if (id && currentDrawing.value) layoutStore.SET_LAYOUT({ showTabBar: true })
  else if (id) lastNote.value = id
}, { immediate: true, flush: 'sync' })
let choosingDrawing = false

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

const newDrawing = () => {
  const stem = t('drawing.untitled')
  let title = `${stem}.excalidraw`
  let number = 2
  while (editorStore.tabs.some(tab => tab.filename === title)) title = `${stem} ${number++}.excalidraw`
  void getSessionActions()?.create(blankDrawing, true, title).catch(reason => {
    void notice.notify({ title: t('drawing.openFailed', { reason: String(reason) }), type: 'error' })
  })
}
const openDrawing = (pathname: unknown) => { void showDrawing(pathname) }

async function insertDrawing(path: string): Promise<boolean> {
  const note = insertionNote.value
  if (!note || !path) return false
  editorStore.UPDATE_CURRENT_FILE(note)
  await nextTick()
  if (!note.pathname || note.isPendingCreation) {
    const saved = await editorStore.FILE_SAVE({ waitForResult: true })
    if (saved?.status !== 'saved') return false
  }
  if (currentFile.value?.id !== note.id || !note.pathname || note.readOnly || note.modeChanging) return false
  const src = drawingDestination(note.pathname, path)
  const image = imageToMarkdown({ src, alt: window.path.basename(path, window.path.extname(path)) })
  editMarkdown(note.id, markdown => [{
    start: markdown.length,
    end: markdown.length,
    text: `${markdown && !markdown.endsWith('\n\n') ? markdown.endsWith('\n') ? '\n' : '\n\n' : ''}${image}\n`
  }])
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
  bus.off('drawing::open', openDrawing)
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
  bus.on('drawing::open', openDrawing)
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
