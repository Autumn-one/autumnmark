<template>
  <div
    class="drawing-workspace"
    @keydown.capture="handleShortcut"
  >
    <div class="drawing-actions">
      <el-button
        :disabled="!canEdit"
        @click="pickDocument"
      >
        {{ t('drawing.addDocument') }}
      </el-button>
      <el-button
        v-if="canInsert"
        :disabled="!canEdit"
        @click="saveDrawing(true)"
      >
        {{ t('drawing.insertIntoNote') }}
      </el-button>
      <el-button
        type="primary"
        :disabled="!canEdit"
        @click="saveDrawing(false)"
      >
        {{ t('menu.file.save') }}
      </el-button>
    </div>
    <form
      v-if="card"
      class="drawing-card-options"
      @submit.prevent="insertCard"
    >
      <label for="drawing-card-section">{{ windowPath.basename(card.path) }}</label>
      <select
        id="drawing-card-section"
        v-model="heading"
      >
        <option value="">
          {{ t('drawing.wholeDocument') }}
        </option>
        <option
          v-for="item in card.document.headings"
          :key="item.githubSlug"
          :value="item.githubSlug"
        >
          {{ item.content }}
        </option>
      </select>
      <el-button native-type="submit">
        {{ t('drawing.addCard') }}
      </el-button>
      <el-button @click="card = null">
        {{ t('common.cancel') }}
      </el-button>
    </form>
    <p
      v-if="error"
      class="drawing-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      ref="canvas"
      class="drawing-canvas"
      @dragover.capture="allowDocumentDrop"
      @drop.capture="dropDocument"
      @dblclick.capture="openSelectedDocument"
    />
  </div>
</template>

<script setup lang="ts">
import '@/services/drawingFonts'
import '@excalidraw/excalidraw/index.css'
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, languages, newElementWith, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { t } from '@/i18n'
import { getSessionActions, useEditorStore } from '@/store/editor'
import type { IFileState } from '@shared/types/files'
import { usePreferencesStore } from '@/store/preferences'
import { isDarkThemeId } from 'common/theme'
import bus from '@/bus'
import {
  documentReference,
  makeDocumentCard,
  readCardDocument,
  parseDrawing,
  referenceForCard,
  referencedDocument,
  refreshDocumentCards,
  serializeDrawing,
  type DrawingScene
} from '@/services/drawingScene'

const props = defineProps<{
  file: IFileState
  canInsert: boolean
  insert: () => Promise<boolean>
}>()
const windowPath = window.path
const name = computed(() => windowPath.basename(props.file.filename, windowPath.extname(props.file.filename)))
const editor = useEditorStore()
const preferences = usePreferencesStore()
const canvas = ref<HTMLDivElement | null>(null)
const api = shallowRef<ExcalidrawImperativeAPI | null>(null)
const ready = ref(false)
const card = shallowRef<{ path: string; document: Awaited<ReturnType<typeof readCardDocument>>; point?: { x: number; y: number } } | null>(null)
const heading = ref('')
const busy = ref(false)
const canEdit = computed(() => ready.value && !busy.value && !props.file.readOnly)
const error = ref('')
const language = computed(() => {
  const locale = preferences.language
  return languages.find(item => item.code.toLowerCase() === locale.toLowerCase())?.code ??
    languages.find(item => item.code === locale.split('-')[0])?.code ?? 'en'
})
const theme = computed(() => isDarkThemeId(preferences.theme) ? 'dark' : 'light')
let root: Root | undefined
let baseline: string | undefined
let incoming = props.file.markdown
let disposed = false
let refreshVersion = 0
let dirtyTimer: ReturnType<typeof setTimeout> | undefined

function currentScene(): DrawingScene | undefined {
  const current = api.value
  if (current) return { elements: current.getSceneElements(), appState: current.getAppState(), files: current.getFiles() }
}

function syncDrawing() {
  if (!ready.value || props.file.readOnly) return
  const scene = currentScene()
  if (!scene) return
  const content = serializeDrawing(scene)
  if (content === baseline) return
  baseline = content
  if (content === props.file.markdown) return
  incoming = content
  editor.UPDATE_DRAWING(props.file.id, content)
}

const initialData = (async() => {
  try {
    const scene = await parseDrawing(props.file.markdown)
    return props.file.pathname ? await refreshDocumentCards(scene, props.file.pathname) : scene
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
    return null
  }
})()

watch([canvas, theme, language, name, () => props.file.readOnly], ([container, activeTheme, langCode, drawingName, readOnly]) => {
  if (!container) return
  root ??= createRoot(container)
  root.render(createElement(Excalidraw, {
    initialData,
    theme: activeTheme,
    langCode,
    name: drawingName,
    viewModeEnabled: readOnly || undefined,
    autoFocus: true,
    handleKeyboardGlobally: false,
    validateEmbeddable: false,
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } },
    excalidrawAPI: (instance: ExcalidrawImperativeAPI) => { api.value = instance },
    onChange: (_elements, state) => {
      if (state.isLoading) return
      if (!ready.value) void initialData.then(initial => {
        const scene = currentScene()
        if (!initial || disposed || !scene || ready.value) return
        baseline = serializeDrawing(scene)
        ready.value = true
      })
      clearTimeout(dirtyTimer)
      dirtyTimer = setTimeout(syncDrawing, 120)
    },
    onLinkOpen: (element, event) => {
      const reference = documentReference(element)
      if (!reference) return
      event.preventDefault()
      openReferencedDocument(reference)
    }
  }))
}, { flush: 'post' })

watch(() => props.file.markdown, async content => {
  const current = api.value
  if (!current || content === incoming) return
  try {
    const scene = await parseDrawing(content)
    const chosen = props.file.pathname ? await refreshDocumentCards(scene, props.file.pathname) : scene
    if (disposed || props.file.markdown !== content) return
    incoming = content
    current.resetScene()
    current.addFiles(Object.values(chosen.files))
    current.updateScene({
      elements: chosen.elements,
      appState: { ...current.getAppState(), ...chosen.appState },
      captureUpdate: CaptureUpdateAction.NEVER
    })
    const live = currentScene()
    if (live) baseline = serializeDrawing(live)
  } catch (reason) { error.value = t('drawing.openFailed', { reason: String(reason) }) }
})

onMounted(() => {
  window.addEventListener('focus', refreshCards)
  bus.on('flush-active-editor', syncDrawing)
})
onBeforeUnmount(() => {
  disposed = true
  bus.off('flush-active-editor', syncDrawing)
  window.removeEventListener('focus', refreshCards)
  clearTimeout(dirtyTimer)
  root?.unmount()
})

async function refreshCards() {
  const current = api.value
  const before = currentScene()
  if (!current || !before || busy.value || !props.file.pathname || editor.currentFile?.id !== props.file.id) return
  const revision = ++refreshVersion
  const refreshed = await refreshDocumentCards(before, props.file.pathname)
  if (disposed || api.value !== current || busy.value || revision !== refreshVersion) return
  const original = new Set(before.elements)
  const replacements: BinaryFileData[] = []
  const elements = current.getSceneElementsIncludingDeleted().map(element => {
    if (element.type !== 'image' || !element.fileId || !original.has(element)) return element
    const file = refreshed.files[element.fileId]
    if (!file || file === before.files[element.fileId]) return element
    const id = crypto.randomUUID() as FileId
    replacements.push({ ...file, id })
    return newElementWith(element, { fileId: id })
  })
  if (!replacements.length) return
  const wasSaved = props.file.isSaved
  current.addFiles(replacements)
  current.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
  const scene = currentScene()
  if (scene && wasSaved) baseline = serializeDrawing(scene)
  syncDrawing()
}

async function saveDrawing(insert: boolean) {
  if (!canEdit.value) return
  busy.value = true
  error.value = ''
  try {
    syncDrawing()
    const saved = await getSessionActions()?.save(props.file.id)
    if (saved?.status !== 'saved') return
    bus.emit('drawing::preview-changed')
    if (insert) await props.insert()
  } catch (reason) {
    error.value = t('drawing.saveFailed', { reason: String(reason) })
  } finally {
    busy.value = false
  }
}

function handleShortcut(event: KeyboardEvent) {
  if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  event.stopPropagation()
  void saveDrawing(false)
}

function openReferencedDocument(reference: NonNullable<ReturnType<typeof documentReference>>) {
  if (!props.file.pathname) return
  const path = referencedDocument(props.file.pathname, reference)
  window.electron.ipcRenderer.send('mt::open-file', path, { anchor: reference.heading })
}

function openSelectedDocument(event: MouseEvent) {
  const current = api.value
  if (!current || !(event.target instanceof HTMLCanvasElement)) return
  const selected = current.getAppState().selectedElementIds
  const elements = current.getSceneElements().filter(element => selected[element.id])
  const reference = elements.length === 1 ? documentReference(elements[0]) : undefined
  if (!reference) return
  event.preventDefault()
  event.stopPropagation()
  openReferencedDocument(reference)
}

async function prepareCard(path: string, point?: { x: number; y: number }) {
  if (!window.fileUtils.hasMarkdownExtension(path)) return
  error.value = ''
  try {
    if (!props.file.pathname) await saveDrawing(false)
    if (!props.file.pathname || disposed) return
    const document = await readCardDocument(path)
    if (disposed) return
    heading.value = ''
    card.value = { path, document, point }
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
  }
}

async function pickDocument() {
  try {
    const path = await window.electron.dialog.showOpenFile({
      title: t('drawing.addDocument'),
      defaultPath: props.file.pathname ? window.path.dirname(props.file.pathname) : undefined,
      filters: [{ name: 'Markdown', extensions: window.fileUtils.MARKDOWN_INCLUSIONS.map(pattern => pattern.replace(/^\*\./, '')) }]
    })
    if (path) await prepareCard(path)
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
  }
}

function allowDocumentDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}

function dropDocument(event: DragEvent) {
  if (!canEdit.value) return
  const file = event.dataTransfer?.files[0]
  if (!file || !window.fileUtils.hasMarkdownExtension(file.name)) return
  const path = window.electron.webUtils.getPathForFile(file)
  if (!path) return
  event.preventDefault()
  event.stopPropagation()
  void prepareCard(path, { x: event.clientX, y: event.clientY })
}

function insertCard() {
  const current = api.value
  const pending = card.value
  if (!current || !pending || !props.file.pathname || !canEdit.value) return
  try {
    const selected = heading.value || undefined
    const reference = referenceForCard(props.file.pathname, pending.path, selected)
    const fileId = crypto.randomUUID() as FileId
    const { file, width, height } = makeDocumentCard(pending.document, pending.path, fileId, selected)
    const state = current.getAppState()
    const point = pending.point ?? { x: state.offsetLeft + state.width / 2, y: state.offsetTop + state.height / 2 }
    const { x, y } = viewportCoordsToSceneCoords({ clientX: point.x, clientY: point.y }, state)
    const [element] = convertToExcalidrawElements([{
      type: 'image', x: x - width / 2, y: y - height / 2, width, height, fileId,
      status: 'saved', link: `${encodeURI(reference.path)}${selected ? '#' + encodeURIComponent(selected) : ''}`,
      customData: { autumnmarkDocument: reference }
    }])
    current.addFiles([file])
    current.updateScene({
      elements: [...current.getSceneElementsIncludingDeleted(), element],
      appState: { selectedElementIds: { [element.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    card.value = null
    syncDrawing()
  } catch (reason) {
    error.value = t('drawing.cardFailed', { reason: String(reason) })
  }
}
</script>

<style>
.drawing-workspace, .drawing-canvas {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.drawing-workspace {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--editorBgColor);
}
.drawing-actions, .drawing-card-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.drawing-workspace .el-button + .el-button {
  margin-left: 0;
}
.drawing-card-options select {
  max-width: 50%;
  padding: 4px;
  color: var(--editorColor);
  background: var(--editorBgColor);
}
.drawing-error {
  margin: 0;
  color: var(--editorColor);
}
.drawing-canvas {
  position: relative;
  border: 1px solid var(--floatBorderColor);
  border-radius: 8px;
  overflow: hidden;
}
</style>
