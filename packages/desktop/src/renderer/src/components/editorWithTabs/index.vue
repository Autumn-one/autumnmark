<template>
  <div
    class="editor-with-tabs"
    :style="{ '--editor-min-width': `${MIN_EDITOR_WIDTH}px` }"
  >
    <tabs v-show="showTabBar" />
    <div class="container">
      <div
        class="document-body"
        :data-document-id="store.currentFile?.id"
      >
        <editor
          v-if="!currentDrawing"
          ref="renderedEditor"
          :image-menu-item="imageMenuItem"
          :markdown="markdown"
          :cursor="cursor"
          :text-direction="textDirection"
          :platform="platform"
          @heading-link="headingLink = $event"
          @edit-embedded-image="handleImage"
        />
        <source-code
          v-if="sourceCode && !currentDrawing"
          ref="sourceEditor"
          :image-menu-item="imageMenuItem"
          :markdown="markdown"
          :muya-index-cursor="muyaIndexCursor"
          :text-direction="textDirection"
          @heading-link="headingLink = $event"
          @edit-embedded-image="handleImage"
        />
        <template v-for="file in drawingTabs" :key="file.id">
          <drawing-canvas
            v-if="openedDrawings.has(file.id)"
            v-show="currentDrawing && store.currentFile?.id === file.id"
            :file="drawingEditorTabs.has(file.id) ? undefined : file"
            :session="drawingEditorTabs.get(file.id)"
            :can-insert="!drawingEditorTabs.has(file.id) && canInsertDrawing(file.id)"
            :insert="(path, content) => insertDrawing(file.id, path, content)"
          />
        </template>
      </div>
    </div>
    <div class="editor-footer">
      <tab-notifications />
      <div v-if="store.currentFile && !currentDrawing" class="document-status">
        <slot name="document-actions" />
        <document-statistics
          :pathname="store.currentFile.pathname"
          :word-count="store.currentFile.wordCount"
          :selection-word-count="store.selectionWordCount"
          :is-saved="store.currentFile.isSaved"
          :read-only="store.currentFile.readOnly"
          :mode-changing="store.currentFile.modeChanging"
          @toggle-reading="store.SET_READ_ONLY(store.currentFile.id, $event)"
        />
        <document-image-status
          :key="store.currentFile.id"
          :embedded="imageCounts.embedded"
          :pending="imageCounts.pending"
          :progress="progress"
          :menu-item="imageMenuItem"
          @convert="convertCurrentImages"
        />
      </div>
    </div>
    <heading-link-picker v-if="headingLink" :request="headingLink" @close="headingLink = null" />
    <embedded-image-dialog
      v-if="embeddedImage"
      :image="embeddedImage"
      :initial-tab="initialTab"
      @close="embeddedImage = null"
    />
  </div>
</template>

<script setup lang="ts">
import { MIN_EDITOR_WIDTH } from '@/util/editorLayout'
import Tabs from './tabs.vue'
import { computed, defineAsyncComponent, ref, shallowRef, shallowReactive, watch } from 'vue'
import { embedDocumentImages, imagePasteJobs } from '@/services/pastedImages'
import { t } from '@/i18n'
import DocumentStatistics from '../titleBar/documentStatistics.vue'
import DocumentImageStatus from './documentImageStatus.vue'
import { imageDestinationEdits, isInlineImage } from '@/util/documentImages'
import { isDrawingPath, isDrawingReference } from '@/util/drawingPaths'
import type { EditMarkdown } from '@shared/markdownEdits'
import { findDocumentImages, type IEmbeddedImageEdit } from '@muyajs/core'
import { useEditorStore } from '@/store/editor'
import { documentVideos } from '@/util/videoAttachments'
import EmbeddedImageDialog from './embeddedImageDialog.vue'
import { dragOriginal, showImageMenu, type EmbeddedTab, reportImageError } from '@/util/embeddedImageActions'
import HeadingLinkPicker from './headingLinkPicker.vue'
import type { HeadingLinkRequest } from '@/util/headingLinks'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'
import { drawingEditorTabs } from '@/services/drawingEditors'
const DrawingCanvas = defineAsyncComponent(() => import('@/components/drawingCanvas.vue'))

const props = defineProps<{
  markdown: string
  // Tab cursor payloads cross the store boundary as unknown.
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
  canInsertDrawing: (id: string) => boolean
  insertDrawing: (id: string, path: string, content?: string) => Promise<boolean>
}>()

const embeddedImage = shallowRef<IEmbeddedImageEdit | null>(null)
const initialTab = shallowRef<EmbeddedTab>('preview')
function handleImage(image: IEmbeddedImageEdit, event?: MouseEvent) {
  if (store.currentFile) image = documentVideos(store.currentFile.id).edit(image)
  const open = (tab: EmbeddedTab) => {
    initialTab.value = tab
    embeddedImage.value = image
  }
  if (event?.type === 'dragstart') dragOriginal(image.src, image.name, image.kind)
  else if (event?.type === 'contextmenu') void showImageMenu(image, event, open).catch(error => reportImageError(error, image.kind))
  else open('preview')
}
const headingLink = shallowRef<HeadingLinkRequest | null>(null)
const store = useEditorStore()
const currentDrawing = computed(() => !!store.currentFile && isDrawingPath(store.currentFile.pathname || store.currentFile.filename))
const drawingTabs = computed(() => store.tabs.filter(file => isDrawingPath(file.pathname || file.filename)))
const openedDrawings = shallowReactive(new Set<string>())
watch(() => store.currentFile?.id, id => {
  if (id && currentDrawing.value) openedDrawings.add(id)
}, { immediate: true })
watch(drawingTabs, files => {
  for (const id of openedDrawings) if (!files.some(file => file.id === id)) openedDrawings.delete(id)
})
const sourceEditor = ref<InstanceType<typeof SourceCode> | null>(null)
const renderedEditor = ref<InstanceType<typeof Editor> | null>(null)
const activeEditor = computed(() => props.sourceCode ? sourceEditor.value : renderedEditor.value)
const readMarkdown = (id: string): string | undefined => activeEditor.value?.readMarkdown(id)
const drawingInsertion = (id: string) => activeEditor.value?.drawingInsertion(id)
const editMarkdown: EditMarkdown = (id, prepare, options) => {
  const view = activeEditor.value
  if (!view) throw new Error(t('batchMedia.changed'))
  view.editMarkdown(id, prepare, options)
}
defineExpose({ drawingInsertion, editMarkdown, readMarkdown })
const imageCounts = shallowRef({ embedded: 0, pending: 0 })
watch([() => store.currentFile?.id, () => props.markdown], ([id, markdown], previous, onCleanup) => {
  const refresh = () => {
    const images = currentDrawing.value ? [] : findDocumentImages(markdown ?? '').filter(image => !isDrawingReference(image.src))
    const pending = images.filter(image => !isInlineImage(image.src)).length
    imageCounts.value = { embedded: images.length - pending, pending }
  }
  if (id !== previous?.[0]) refresh()
  else {
    const timer = setTimeout(refresh, 160)
    onCleanup(() => clearTimeout(timer))
  }
}, { immediate: true })

const busy = shallowReactive(new Set<string>())
const ready = shallowReactive(new Map<string, { pathname?: string | null; converted: Map<string, string> }>())
const imageMenuItem = computed(() => {
  const tab = store.currentFile
  const count = imageCounts.value.pending
  const key = count ? 'convertAll' : imageCounts.value.embedded ? 'allEmbedded' : 'noImages'
  return {
    id: 'embedDocumentImages',
    label: t('documentImages.' + key, { count }),
    enabled: !!tab && !tab.readOnly && !tab.modeChanging && count > 0 && !busy.has(tab.id),
    click: () => { if (tab?.id === store.currentFile?.id) void convertCurrentImages() }
  }
})

async function convertCurrentImages() {
  const tab = store.currentFile
  if (!tab || tab.readOnly || tab.modeChanging || busy.has(tab.id)) return
  store.flushActiveEditor()
  const sources = findDocumentImages(tab.markdown).map(image => image.src).filter(src => !isInlineImage(src) && !isDrawingReference(src))
  if (!sources.length) return
  const { id, pathname } = tab
  busy.add(id)
  try {
    const converted = await embedDocumentImages(sources, tab)
    if (converted.size && store.tabs.some(file => file.id === id)) ready.set(id, { pathname, converted })
  } finally {
    busy.delete(id)
  }
}

// A tab can change editors during a download. Commit through its live editor so undo and concurrent typing survive.
watch([() => store.currentFile, () => props.sourceCode ? sourceEditor.value : renderedEditor.value,
  () => store.currentFile && ready.get(store.currentFile.id)], ([tab, view, result]) => {
  if (!tab || !view || !result) return
  ready.delete(tab.id)
  if (!tab.readOnly && !tab.modeChanging && tab.pathname === result.pathname) {
    view.editMarkdown(tab.id, markdown => imageDestinationEdits(markdown, result.converted))
  }
}, { flush: 'post' })
watch(() => store.tabs.map(tab => tab.id), ids => {
  for (const id of ready.keys()) if (!ids.includes(id)) ready.delete(id)
})
const progress = computed(() => {
  const totals = { completed: 0, total: 0, failed: 0 }
  for (const job of imagePasteJobs) {
    if (!job.visible || job.tabId !== store.currentFile?.id) continue
    totals.completed += job.completed
    totals.total += job.total
    totals.failed += job.failed
  }
  return totals
})
watch([() => props.sourceCode, () => store.currentFile?.id, () => store.currentFile?.readOnly], () => {
  embeddedImage.value = null
  headingLink.value = null
})

</script>

<style scoped>
.editor-footer {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: none;
}
.document-status {
  position: absolute;
  inset-inline-end: 16px;
  bottom: calc(100% + 14px);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 10px;
  background: var(--floatBgColor);
  box-shadow: 0 2px 9px var(--editorColor10);
  color: var(--editorColor);
  font-variant-numeric: tabular-nums;
}
.editor-with-tabs {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    display: flex;
    position: relative;
    min-height: 0;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
  }
}
.document-body {
  flex: 1;
  min-width: var(--editor-min-width);
  container-type: inline-size;
  height: 100%;
  overflow: hidden;
}
</style>

<style>
.mu-embedded-image:not(.mu-embedded-picture),
.embedded-image-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid;
  border-radius: 4px;
  padding: 0.1em 0.45em;
  font: 0.85em var(--codeFontFamily, monospace);
  vertical-align: middle;
  cursor: pointer;
}
.mu-embedded-image:not(.mu-embedded-picture) {
  border-color: var(--editorColor10);
  background: var(--floatHoverColor);
  color: var(--editorColor);
  flex-direction: column;
  max-width: 100%;
}
.embedded-image-chip {
  color: inherit;
  border-color: color-mix(in srgb, currentColor 25%, transparent);
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.mu-embedded-video video {
  max-width: 100%;
  max-height: 36vh;
  object-fit: contain;
  cursor: default;
}
.mu-embedded-video > button {
  max-width: 100%;
  border: 0;
  padding: 0.15em 0.4em;
  background: transparent;
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
  cursor: grab;
}
.mu-embedded-video > button:is(:hover, :focus-visible) {
  text-decoration: underline;
}
</style>
