<template>
  <el-dialog
    :model-value="true"
    class="embedded-image-dialog"
    append-to-body
    align-center
    :title="label('title')"
    :show-close="false"
    width="min(92vw, 1560px)"
    @opened="focusSizeEntry"
    @close="emit('close')"
  >
    <div
      ref="workspace"
      class="embedded-image-workspace"
      tabindex="-1"
      @paste="paste"
      @keydown="onKey"
      @image-history="menuHistory"
    >
      <header>
        <strong><VideoCamera v-if="isVideo" /><Picture v-else />{{ label('title') }}</strong>
        <div
          role="tablist"
          :aria-label="label('title')"
          class="tabs"
        >
          <button
            v-for="item in tabs"
            :id="'embedded-tab-' + item"
            :key="item"
            role="tab"
            :aria-selected="tab === item"
            :aria-controls="'embedded-panel-' + item"
            :tabindex="tab === item ? 0 : -1"
            @click="tab = item"
            @keydown.left.prevent="switchTab"
            @keydown.right.prevent="switchTab"
          >
            <VideoCamera v-if="item === 'preview' && isVideo" /><Picture
              v-else-if="item === 'preview'"
            /><span
              v-else
              aria-hidden="true"
            >‹/›</span>{{
              item === 'preview'
                ? label('preview')
                : t(linkedVideo ? 'video.location' : 'embeddedImage.source')
            }}
          </button>
        </div>
        <div class="header-actions">
          <button
            v-if="!image.readOnly"
            :disabled="!history.length"
            :title="modifier + '+Z'"
            @click="undo"
          >
            <RefreshLeft />{{ t('menu.edit.undo') }}<kbd>{{ modifier }}+Z</kbd>
          </button>
          <el-dropdown
            v-if="!image.readOnly"
            split-button
            type="primary"
            trigger="click"
            @click="picker?.click()"
          >
            {{ label('replace') }}
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="picker?.click()">
                  {{ label('choose') }}
                </el-dropdown-item>
                <el-dropdown-item @click="pasteFromClipboard">
                  {{ label('fromClipboard') }}
                </el-dropdown-item>
                <el-dropdown-item
                  divided
                  @click="remove"
                >
                  {{ label('delete') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button
            :aria-label="t('editor.mediaViewer.close')"
            @click="emit('close')"
          >
            <Close />
          </button>
        </div>
      </header>
      <section
        v-show="tab === 'preview'"
        id="embedded-panel-preview"
        role="tabpanel"
        aria-labelledby="embedded-tab-preview"
        class="preview-pane"
        @dragover.prevent="dragOver"
        @dragleave="dragLeave"
        @drop.prevent.stop="drop"
      >
        <div
          ref="stage"
          class="image-stage"
          :class="{ dropping, pannable }"
          @contextmenu.prevent.stop="showPreviewMenu"
        >
          <video
            v-if="isVideo && tab === 'preview'"
            class="embedded-video-player"
            controls
            playsinline
            preload="metadata"
            :src="playbackUrl"
            :aria-label="image.name || label('title')"
            @error="error = label('invalid')"
          />
          <img
            v-if="!isVideo"
            ref="picture"
            class="embedded-image-preview"
            :src="src"
            :alt="image.name || label('title')"
            :draggable="!pannable"
            @dragstart.prevent="dragOut"
            @load="imageLoaded"
            @error="error = label('invalid')"
          >
          <span
            v-if="dropping"
            class="drop-hint"
          >{{ label('drop') }}</span>
        </div>
        <embedded-picture-size
          v-if="image.size && !image.readOnly"
          :key="src"
          ref="sizeEntry"
          :dimensions="image.size"
          :natural="natural"
          @apply="applySize"
        />
        <footer>
          <span
            v-if="!image.readOnly"
            class="hint"
          >{{
            label('hint', { shortcut: modifier + '+V' })
          }}</span>
          <button
            draggable="true"
            class="drag-handle"
            @dragstart.prevent="dragOut"
          >
            <Upload />{{ label('drag') }}
          </button>
          <div
            v-if="!isVideo"
            class="zoom"
          >
            <button
              :aria-label="t('editor.mediaViewer.zoomOut')"
              @click="controller?.zoomBy(0.8)"
            >
              <Minus />
            </button>
            <output>{{ percent }}%</output>
            <button
              :aria-label="t('editor.mediaViewer.zoomIn')"
              @click="controller?.zoomBy(1.25)"
            >
              <Plus />
            </button>
            <button @click="fit">
              <FullScreen />{{ t('editor.mediaViewer.fit') }}
            </button>
          </div>
        </footer>
      </section>
      <section
        v-if="tab === 'source'"
        id="embedded-panel-source"
        role="tabpanel"
        aria-labelledby="embedded-tab-source"
        class="source-pane"
      >
        <p v-if="diskVideo">{{ t('video.streamedSource', { size: (diskVideo.size / 1048576).toFixed(1) }) }}</p>
        <div v-else class="source-heading">
          <label for="embedded-data">{{
            linkedVideo ? t('video.location') : 'Base64 · ' + mime
          }}</label>
          <button @click="copyDraft">
            <DocumentCopy />{{ t('menu.edit.copy') }}
          </button>
        </div>
        <textarea
          v-if="!diskVideo"
          id="embedded-data"
          v-model="draft"
          :readonly="image.readOnly || linkedVideo"
          spellcheck="false"
          autocapitalize="off"
          @input="draftChanged"
        />
        <footer v-if="!image.readOnly && !linkedVideo && !diskVideo">
          <span class="hint">{{ draft !== src ? t('embeddedImage.dirty') : '' }}</span>
          <button
            :disabled="draft === src"
            @click="discardDraft"
          >
            {{ t('embeddedImage.discard') }}
          </button>
          <button
            class="primary"
            :disabled="draft === src"
            @click="applyDraft"
          >
            {{ t('embeddedImage.apply') }}
          </button>
        </footer>
      </section>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <input
        ref="picker"
        type="file"
        :accept="isVideo ? 'video/*,.mkv,.m4v,.ogv,.mov' : 'image/*'"
        hidden
        @change="replaceFile"
      >
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Close,
  DocumentCopy,
  FullScreen,
  Minus,
  Picture,
  VideoCamera,
  Plus,
  RefreshLeft,
  Upload
} from '@element-plus/icons-vue'
import type { IEmbeddedImageEdit, IImageDimensions } from '@muyajs/core'
import EmbeddedPictureSize from './embeddedPictureSize.vue'
import { isVideoData, videoPlaybackUrl } from '@/util/video'
import { diskVideoInfo } from '@shared/diskVideo'
import { documentVideos } from '@/util/videoAttachments'
import { useEditorStore } from '@/store/editor'
import { videoFromTransfer } from '@muyajs/core'
import { ZoomPanController } from '@/util/zoomPan'
import { isMac } from '@/util'
import { readClipboardImage, isEmbeddedImageUrl } from '@/util/embedImage'
import {
  copySource,
  dragOriginal,
  imageFromTransfer,
  showImageMenu,
  reportImageError,
  validatedSource,
  type EmbeddedTab
} from '@/util/embeddedImageActions'

const props = defineProps<{ image: IEmbeddedImageEdit; initialTab: EmbeddedTab }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const isVideo = computed(() => props.image.kind === 'video')
const label = (key: string, values: Record<string, string> = {}) =>
  t((isVideo.value ? 'video.' : 'embeddedImage.') + key, values)
const tabs = ['preview', 'source'] as const
const modifier = isMac ? '⌘' : 'Ctrl'
const tab = ref(props.initialTab === 'size' ? 'preview' : props.initialTab)
const sizeEntry = ref<InstanceType<typeof EmbeddedPictureSize>>()
const natural = ref({ width: 0, height: 0 })
const src = ref(props.image.src)
const editorStore = useEditorStore()
const playbackUrl = computed(() => {
  const file = editorStore.currentFile
  const videos = file && documentVideos(file.id)
  return videos?.playback(videos.storedSource(src.value)) ?? videoPlaybackUrl(src.value)
})
const draft = ref(src.value)
const diskVideo = computed(() => isVideo.value && diskVideoInfo(src.value))
const linkedVideo = computed(() => isVideo.value && !isVideoData(src.value))
const mime = computed(() => src.value.slice(5, src.value.indexOf(';')))
const history = ref<string[]>([])
const error = ref('')
const stage = ref<HTMLElement>()
const workspace = ref<HTMLElement>()
const picture = ref<HTMLImageElement>()
const picker = ref<HTMLInputElement>()
const dropping = ref(false)
const pannable = ref(false)
const percent = ref(100)
let controller: ZoomPanController | undefined
let generation = 0

watch(
  [stage, picture],
  ([viewport, img], _, cleanup) => {
    if (!viewport || !img) return
    controller = new ZoomPanController(viewport, img, {
      canPan: () => pannable.value,
      onBackdropClick: () => emit('close'),
      onChange: (state) => {
        const ratio = img.naturalWidth ? img.offsetWidth / img.naturalWidth : 1
        percent.value = Math.round(ratio * state.scale * 100)
        pannable.value =
          img.offsetWidth * state.scale > viewport.clientWidth + 1 ||
          img.offsetHeight * state.scale > viewport.clientHeight + 1
      }
    })
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth) fit()
    })
    observer.observe(viewport)
    cleanup(() => {
      observer.disconnect()
      controller?.destroy()
    })
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  generation++
})

function switchTab() {
  tab.value = tab.value === 'preview' ? 'source' : 'preview'
  void nextTick(() => document.getElementById('embedded-tab-' + tab.value)?.focus())
}
function fit() {
  controller?.fit()
}
function imageLoaded() {
  const img = picture.value
  if (img) natural.value = { width: img.naturalWidth, height: img.naturalHeight }
  fit()
}
function focusSizeEntry() {
  if (props.initialTab === 'size') sizeEntry.value?.focusWidth()
}
function applySize(dimensions: IImageDimensions) {
  if (props.image.readOnly || !props.image.size || !props.image.matches(src.value)) return
  props.image.size.apply(dimensions, src.value)
  emit('close')
}
function dragOut() {
  dragOriginal(src.value, props.image.name, props.image.kind)
}
function remove() {
  props.image.apply(null, src.value)
  emit('close')
}
function undo() {
  const previous = history.value.at(-1)
  if (!previous || !props.image.matches(src.value)) return
  generation++
  props.image.undo()
  if (props.image.matches(previous)) {
    history.value.pop()
    src.value = draft.value = previous
    error.value = ''
  }
  workspace.value?.focus()
}
function menuHistory(event: Event) {
  const command = (event as CustomEvent<string>).detail
  if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) document.execCommand(command)
  else if (command === 'undo') undo()
}
function onKey(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement ||
    !(event.ctrlKey || event.metaKey) ||
    event.shiftKey
  )
    return
  const key = event.key.toLowerCase()
  if (key !== 'z' && (key !== 'v' || tab.value !== 'preview' || props.image.readOnly)) return
  event.preventDefault()
  event.stopPropagation()
  if (key === 'z') undo()
  else pasteFromClipboard()
}

function discardDraft() {
  draftChanged()
  draft.value = src.value
}

function draftChanged() {
  generation++
  error.value = ''
}

function applySource(next: string, expected: string) {
  if (expected !== next) {
    props.image.apply(next, expected)
    if (!props.image.matches(next)) return
    history.value.push(expected)
  }
  src.value = draft.value = next
  error.value = ''
  workspace.value?.focus()
}

function showPreviewMenu(event: MouseEvent) {
  const expected = src.value
  const target: IEmbeddedImageEdit = {
    ...props.image,
    src: expected,
    matches: (value) => !!workspace.value?.isConnected && props.image.matches(value),
    apply: (value) => {
      generation++
      if (value === null) remove()
      else if (!isVideo.value && !isEmbeddedImageUrl(value)) {
        props.image.apply(value, expected)
        emit('close')
      }
      else applySource(value, expected)
    }
  }
  void showImageMenu(target, event, (selected) => {
    tab.value = selected === 'size' ? 'preview' : selected
    if (selected === 'size') void nextTick(() => sizeEntry.value?.focusWidth())
  }).catch((reason) => reportImageError(reason, props.image.kind))
}

async function replace(input: File | string | Promise<File | string | undefined>) {
  if (props.image.readOnly) return
  const request = ++generation
  const expected = src.value
  try {
    const value = await input
    if (!value) throw new Error()
    const next = await validatedSource(value, props.image.kind, expected)
    if (!next) return
    if (request !== generation || !props.image.matches(expected)) return
    applySource(next, expected)
  } catch {
    if (request === generation) error.value = label('invalid')
  }
}
function applyDraft() {
  const value = draft.value.trim()
  if (isVideo.value ? !isVideoData(value) : !isEmbeddedImageUrl(value)) {
    error.value = label('invalid')
    return
  }
  void replace(value)
}
function replaceFile() {
  const file = picker.value?.files?.[0]
  if (picker.value) picker.value.value = ''
  if (file) void replace(file)
}
function pasteFromClipboard() {
  void replace(readClipboardImage(props.image.kind))
}
function paste(event: ClipboardEvent) {
  if (tab.value !== 'preview' || props.image.readOnly || event.target instanceof HTMLInputElement) return
  event.preventDefault()
  event.stopPropagation()
  const input = isVideo.value
    ? videoFromTransfer(event.clipboardData)
    : imageFromTransfer(event.clipboardData)
  void replace(input ?? readClipboardImage(props.image.kind))
}
function dragOver(event: DragEvent) {
  if (props.image.readOnly) return
  dropping.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function dragLeave(event: DragEvent) {
  if (!(
    event.relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
  ))
    dropping.value = false
}
function drop(event: DragEvent) {
  if (props.image.readOnly) return
  dropping.value = false
  const input = isVideo.value
    ? videoFromTransfer(event.dataTransfer)
    : imageFromTransfer(event.dataTransfer)
  if (input) void replace(input)
  else error.value = label('invalid')
}
async function copyDraft() {
  try {
    await copySource(draft.value)
  } catch {
    error.value = t('embeddedImage.copyFailed')
  }
}
</script>

<style>
.el-dialog.embedded-image-dialog {
  padding: 0;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
}
.embedded-image-dialog > .el-dialog__header {
  display: none;
}
.embedded-image-dialog .el-dialog__body {
  padding: 0;
}
</style>
<style scoped>
.embedded-image-workspace {
  display: flex;
  flex-direction: column;
  height: min(90vh, 1080px);
  color: #25322e;
  background: white;
  outline: none;
}
header,
footer,
.tabs,
.header-actions,
.zoom,
.source-heading,
strong,
button {
  display: flex;
  align-items: center;
}
header,
footer,
.source-heading {
  gap: 12px;
  padding: 0 16px;
}
header {
  min-height: 52px;
  border-bottom: 1px solid #dce1df;
  flex-wrap: wrap;
}
strong {
  gap: 8px;
  font-size: 16px;
  padding-right: 16px;
  border-right: 1px solid #dce1df;
}
svg {
  width: 17px;
  height: 17px;
  flex: none;
}
kbd {
  font-family: inherit;
  font-size: 11px;
  border: 1px solid #ccd5d0;
  padding: 1px 4px;
  border-radius: 3px;
}
strong svg,
.tabs [aria-selected='true'] {
  color: #078754;
}
button {
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  background: transparent;
  cursor: pointer;
  border: 0;
  border-radius: 4px;
}
button:hover {
  background: #eef4f0;
}
button:focus-visible,
textarea:focus-visible {
  outline: 2px solid #078754;
  outline-offset: -2px;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.tabs {
  height: 52px;
}
.tabs button {
  height: 100%;
  border-radius: 0;
  border-bottom: 3px solid transparent;
}
.tabs [aria-selected='true'] {
  border-color: #099762;
  font-weight: 600;
}
.header-actions,
.zoom {
  margin-left: auto;
  gap: 5px;
}
.header-actions {
  --el-color-primary: #078754;
}
.preview-pane,
.source-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.preview-pane {
  background: #f3f5f5;
  padding-top: 16px;
}
.image-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  flex: 1;
  margin: 0 16px 16px;
  overflow: hidden;
}
.embedded-video-player {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  background: #202421;
}
.embedded-image-preview {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  cursor: grab;
  box-shadow: 0 1px 5px #0002;
}
.dropping {
  outline: 2px dashed #078754;
  outline-offset: -2px;
}
.drop-hint {
  position: absolute;
  bottom: 12px;
  background: #fff;
  padding: 6px 16px;
  border-radius: 4px;
  pointer-events: none;
}
footer {
  min-height: 42px;
  background: white;
  border-top: 1px solid #dce1df;
  flex-wrap: wrap;
}
.hint {
  color: #52605a;
  font-size: 12px;
}
.drag-handle {
  cursor: grab;
}
.zoom output {
  min-width: 4ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.source-heading {
  min-height: 48px;
  justify-content: space-between;
}
.source-heading label {
  font-weight: 600;
}
textarea {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  margin: 0 16px 14px;
  padding: 14px;
  resize: none;
  color: #273830;
  background: #fafcfb;
  border: 1px solid #cdd6d0;
  border-radius: 5px;
  font: 13px/1.65 var(--codeFontFamily, monospace);
  overflow-wrap: anywhere;
}
.source-pane .hint {
  margin-right: auto;
}
.primary {
  background: #078754;
  color: #fff;
}
.primary:hover {
  background: #076c47;
}
[role='alert'] {
  padding: 6px 16px;
  margin: 0;
  color: #a12a20;
  background: #fff4ef;
}
@media (max-width: 760px) {
  header,
  footer {
    gap: 4px;
    padding-inline: 6px;
  }
  header strong {
    display: none;
  }
  .hint {
    flex: 1;
  }
}
</style>
