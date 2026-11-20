<template>
  <div class="editor-container">
    <title-bar
      :project="projectTree"
      :pathname="pathname"
      :filename="filename"
      :active="windowActive"
      :word-count="wordCount"
      :selection-word-count="selectionWordCount"
      :platform="platform"
      :is-saved="isSaved"
    />

    <div class="editor-workspace">
      <side-bar v-if="init" />

      <div class="editor-middle">
        <recent v-if="!hasCurrentFile && init" />
        <editor-with-tabs
          v-if="hasCurrentFile && init"
          :markdown="markdown"
          :cursor="cursor"
          :muya-index-cursor="muyaIndexCursor"
          :source-code="sourceCode && !currentFile?.readOnly"
          :show-tab-bar="showTabBar"
          :text-direction="textDirection"
          :platform="platform"
        />
        <command-palette />
        <about-dialog />
        <export-setting-dialog />
        <rename />
        <import-modal />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle, type AddStylesOptions } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import AboutDialog from '@/components/about/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import Rename from '@/components/rename/index.vue'
import ImportModal from '@/components/import/index.vue'
import bus from '@/bus'
import { DEFAULT_STYLE } from '@/config'
import { useLayoutStore } from '@/store/layout'
import { useListenForMainStore } from '@/store/listenForMain'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useProjectStore } from '@/store/project'
import { useNotificationStore } from '@/store/notification'
import { startWindowSession } from '@/services/windowSession'
import { videoMime } from '@shared/embeddedImage'

const mainStore = useMainStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)

const { windowActive, platform, init } = storeToRefs(mainStore)
const { showTabBar } = storeToRefs(layoutStore)
const { sourceCode, theme, customCss, textDirection, zoom } = storeToRefs(preferencesStore)
const { projectTree } = storeToRefs(projectStore)
const { currentFile, selectionWordCount } = storeToRefs(editorStore)

watch(
  () => [currentFile.value?.id, currentFile.value?.readOnly],
  () => {
    window.electron.ipcRenderer.send(
      'mt::update-document-mode',
      !!currentFile.value?.readOnly,
      !!currentFile.value
    )
  },
  { immediate: true }
)

const pathname = computed(() => currentFile.value?.pathname)
const filename = computed(() => currentFile.value?.filename)
const isSaved = computed(() => currentFile.value?.isSaved)
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
const wordCount = computed(() => currentFile.value?.wordCount)
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

watch(theme, (value, oldValue) => {
  if (value !== oldValue) {
    addThemeStyle(value)
  }
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
  const data = event.dataTransfer
  if (!data?.types.length) return
  if (currentFile.value?.readOnly && event.target instanceof Element && event.target.closest('.mu-editor')) {
    event.preventDefault()
    data.dropEffect = 'none'
    return
  }
  if (data.types.includes('Files')) {
    const kind = fileDragKind(data)
    if (kind === 'document' || (kind === 'unknown' && !currentFile.value)) {
      event.preventDefault()
      if (timer.value) clearTimeout(timer.value)
      timer.value = setTimeout(() => bus.emit('importDialog', false), 300)
      bus.emit('importDialog', true)
    } else if (event.target instanceof Element && event.target.closest('.mu-editor, .source-code')) {
      event.preventDefault()
    }
    data.dropEffect = 'copy'
  } else if (!data.types.includes('text/uri-list')) {
    event.stopPropagation()
    data.dropEffect = 'none'
  }
}

function handleDocumentDrop(event: DragEvent) {
  const data = event.dataTransfer
  if (!data?.files.length || !currentFile.value || currentFile.value.readOnly ||
    !(event.target instanceof Element) || !event.target.closest('.mu-editor, .source-code')) return
  const files = Array.from(data.files)
  if (files.some(file => /^(image|video)\//.test(file.type) || videoMime(file.name))) return
  const paths = files.map(file => window.electron.webUtils.getPathForFile(file)).filter(Boolean)
  if (paths.length) {
    event.preventDefault()
    event.stopPropagation()
    window.electron.ipcRenderer.send('mt::window::drop', paths)
  }
}

let stopSidebarContextMenu: (() => void) | undefined
let stopWindowSession: (() => void) | undefined
let stopEditListener: (() => void) | undefined
onUnmounted(() => {
  window.removeEventListener('dragover', handleWindowDragOver)
  window.removeEventListener('drop', handleDocumentDrop, true)
  if (timer.value) clearTimeout(timer.value)
  stopSidebarContextMenu?.()
  stopWindowSession?.()
  stopEditListener?.()
})

onMounted(async () => {
  if (window.marktext?.initialState) {
    preferencesStore.SET_USER_PREFERENCE(window.marktext.initialState)
  }

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  stopEditListener = listenForMainStore.LISTEN_FOR_EDIT()
  preferencesStore.LISTEN_FOR_VIEW()
  listenForMainStore.LISTEN_FOR_SHOW_DIALOG()
  listenForMainStore.LISTEN_FOR_PANDOC_EXPORT()
  listenForMainStore.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
  projectStore.LISTEN_FOR_UPDATE_PROJECT()
  projectStore.LISTEN_FOR_LOAD_PROJECT()
  stopSidebarContextMenu = projectStore.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
  preferencesStore.ASK_FOR_USER_PREFERENCE()
  preferencesStore.LISTEN_TOGGLE_VIEW()
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

  window.addEventListener('dragover', handleWindowDragOver)
  window.addEventListener('drop', handleDocumentDrop, true)

  nextTick(() => {
    // `initialState` from bootstrap carries nullable URL params (string|null);
    // `addStyles` requires non-null `theme` / `codeFontFamily` strings.
    // Coalesce against DEFAULT_STYLE for every nullable field.
    const init = window.marktext?.initialState
    const style: AddStylesOptions = {
      theme: init?.theme ?? DEFAULT_STYLE.theme,
      codeFontFamily: init?.codeFontFamily ?? DEFAULT_STYLE.codeFontFamily,
      codeFontSize: init?.codeFontSize ?? DEFAULT_STYLE.codeFontSize,
      hideScrollbar: init?.hideScrollbar ?? DEFAULT_STYLE.hideScrollbar
    }
    addStyles(style)
  })
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
}

.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--editorBgColor);
}
</style>
