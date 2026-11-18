<template>
  <header
    class="title-bar-editor-bg"
    :class="{ 'tabs-visible': showTabBar }"
  >
    <div
      class="title-bar"
      :class="[
        { active: active },
        { 'tabs-visible': showTabBar },
        { frameless: titleBarStyle === 'custom' },
        { 'has-menubar': showCustomTitleBar },
        { isOsx: isOsx }
      ]"
    >
      <application-menu v-if="showCustomTitleBar" />
      <div
        v-if="titleBarStyle !== 'native' || isOsx"
        class="title"
        @dblclick.stop="toggleMaxmizeOnMacOS"
      >
        <span v-if="!filename">{{ APP_NAME }}</span>
        <span v-else>
          <span
            class="save-dot"
            :class="{ show: !isSaved }"
          />
          <span
            ref="pathContainer"
            class="path"
            :class="{
              'path-overflowing': pathOverflows,
              'path-hovered': pathHover === true,
              'path-dom-hover': pathHover === null
            }"
            :style="{
              '--path-overflow': `${pathOverflow}px`,
              '--path-scroll-duration': `${Math.max(0.8, pathOverflow / 40)}s`
            }"
          >
            <span class="path-viewport">
              <bdi
                ref="pathContent"
                class="path-content"
                dir="ltr"
              >
                <span
                  v-for="(path, index) of paths"
                  :key="index"
                >
                  {{ path }}
                  <el-icon
                    class="path-arrow"
                    :size="12"
                  >
                    <ArrowRight />
                  </el-icon>
                </span>
                <span
                  class="filename"
                  :class="{ isOsx: platform === 'darwin' }"
                  @click="rename"
                >
                  {{ filename }}
                </span>
              </bdi>
            </span>
          </span>
        </span>
      </div>
      <div :class="showCustomTitleBar ? 'statistics-toolbar title-no-drag' : 'right-toolbar'">
        <document-statistics
          v-if="wordCount"
          :pathname="pathname"
          :word-count="wordCount"
          :selection-word-count="selectionWordCount"
          :is-saved="isSaved"
          :read-only="!!currentFile?.readOnly"
          :mode-changing="!!currentFile?.modeChanging"
          @toggle-reading="setReadingMode"
        />
        <announcement-bell />
      </div>
      <div
        v-if="titleBarStyle === 'custom' && !isFullScreen && !isOsx"
        class="right-toolbar window-controls"
        :class="[{ 'title-no-drag': titleBarStyle === 'custom' }]"
      >
        <icon-tooltip :content="t('titleBar.minimize')">
          <button
            type="button"
            class="plain-button frameless-titlebar-button frameless-titlebar-minimize"
            :aria-label="t('titleBar.minimize')"
            @click.stop="handleMinimizeClick"
          >
            <span>
              <svg
                width="10"
                height="10"
              >
                <path :d="windowIconMinimize" />
              </svg>
            </span>
          </button>
        </icon-tooltip>
        <icon-tooltip :content="maximizeLabel">
          <button
            type="button"
            class="plain-button frameless-titlebar-button frameless-titlebar-toggle"
            :aria-label="maximizeLabel"
            @click.stop="handleMaximizeClick"
          >
            <span>
              <svg
                width="10"
                height="10"
              >
                <path
                  v-show="!isMaximized"
                  :d="windowIconMaximize"
                />
                <path
                  v-show="isMaximized"
                  :d="windowIconRestore"
                />
              </svg>
            </span>
          </button>
        </icon-tooltip>
        <icon-tooltip
          :content="t('titleBar.close')"
          placement="bottom-end"
        >
          <button
            type="button"
            class="plain-button frameless-titlebar-button frameless-titlebar-close"
            :aria-label="t('titleBar.close')"
            @click.stop="handleCloseClick"
          >
            <span>
              <svg
                width="10"
                height="10"
              >
                <path :d="windowIconClose" />
              </svg>
            </span>
          </button>
        </icon-tooltip>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { usePreferencesStore } from '@/store/preferences.js'
import { useLayoutStore } from '@/store/layout.js'
import { ref, computed, watch, watchPostEffect, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { minimizePath, restorePath, maximizePath, closePath } from '../../assets/window-controls.js'
import { PATH_SEPARATOR } from '../../config'
import { isMac as isOsxPlatform } from '@/util'
import { pathBreadcrumb } from './pathBreadcrumb'
import { buildWindowTitle } from './windowTitle'
import { useEditorStore } from '@/store/editor'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from '@element-plus/icons-vue'
import IconTooltip from '@/components/iconTooltip/index.vue'
import DocumentStatistics from './documentStatistics.vue'
import ApplicationMenu from './applicationMenu.vue'
import AnnouncementBell from './announcementBell.vue'
import type { FileWordCount } from '@shared/types/files'
import { APP_NAME } from '@shared/brand'

interface ProjectInfo {
  name?: string
}

const props = defineProps<{
  project?: ProjectInfo | null
  filename?: string
  pathname?: string
  active?: boolean
  wordCount?: FileWordCount | null
  selectionWordCount?: FileWordCount | null
  platform?: string
  isSaved?: boolean
}>()

const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const editorStore = useEditorStore()
const { currentFile } = storeToRefs(editorStore)
const setReadingMode = (readOnly: boolean): void => {
  if (currentFile.value) void editorStore.SET_READ_ONLY(currentFile.value.id, readOnly)
}
const { t } = useI18n()

const isOsx = isOsxPlatform
const windowIconMinimize = minimizePath
const windowIconRestore = restorePath
const windowIconMaximize = maximizePath
const windowIconClose = closePath

const isFullScreen = ref(false)
const isMaximized = ref(false)

onMounted(async () => {
  try {
    const [fs, max] = await Promise.all([
      window.electron.windowControl.isFullScreen(),
      window.electron.windowControl.isMaximized()
    ])
    isFullScreen.value = !!fs
    isMaximized.value = !!max
  } catch {
    // Window state is best-effort; keep the previous values if the query fails.
  }
})

const { titleBarStyle } = storeToRefs(preferencesStore)
const { showTabBar } = storeToRefs(layoutStore)

const paths = computed(() => pathBreadcrumb(props.pathname ?? '', PATH_SEPARATOR))
const pathContainer = ref<HTMLElement | null>(null)
const pathContent = ref<HTMLElement | null>(null)
const pathOverflow = ref(0)
const pathOverflows = computed(() => pathOverflow.value > 0)
const pathHover = ref<boolean | null>(false)

watchPostEffect((onCleanup) => {
  const container = pathContainer.value
  const content = pathContent.value
  if (!container || !content) {
    pathOverflow.value = 0
    return
  }

  const observer = new ResizeObserver(() => {
    pathOverflow.value = Math.max(
      0,
      content.getBoundingClientRect().width - container.getBoundingClientRect().width
    )
  })
  observer.observe(container)
  observer.observe(content)
  onCleanup(() => observer.disconnect())
})

watchPostEffect((onCleanup) => {
  const container = pathContainer.value
  if (!container || !pathOverflows.value || !props.active) return

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Native dragging regions do not send pointer events to the renderer.
  const checkCursor = async () => {
    const { left, top, right, bottom } = container.getBoundingClientRect()
    const hovered = await window.electron.ipcRenderer
      .invoke('mt::win::is-cursor-over', { left, top, right, bottom })
      .catch(() => false)
    if (stopped) return

    pathHover.value = hovered
    timer = setTimeout(checkCursor, hovered === null ? 250 : 50)
  }

  onCleanup(() => {
    stopped = true
    clearTimeout(timer)
    pathHover.value = false
  })
  void checkCursor()
})

const showCustomTitleBar = computed(() => {
  return titleBarStyle.value === 'custom' && !isOsx
})

const maximizeLabel = computed(() =>
  isMaximized.value ? t('titleBar.restore') : t('titleBar.maximize')
)

watch(
  () => [props.filename, props.project?.name] as const,
  ([filename, projectName]) => {
    document.title = buildWindowTitle(filename, projectName ?? '', isOsx)
  },
  { immediate: true }
)

const handleCloseClick = () => {
  window.electron.windowControl.close()
}

const handleMaximizeClick = async () => {
  if (isFullScreen.value) {
    window.electron.windowControl.setFullScreen(false)
    return
  }
  if (isMaximized.value) window.electron.windowControl.unmaximize()
  else window.electron.windowControl.maximize()
}

const toggleMaxmizeOnMacOS = () => {
  if (isOsx) {
    handleMaximizeClick()
  }
}

const handleMinimizeClick = () => {
  window.electron.windowControl.minimize()
}

const rename = () => {
  if (props.platform === 'darwin') {
    editorStore.RESPONSE_FOR_RENAME()
  }
}

const onMaximize = () => {
  isMaximized.value = true
}
const onUnmaximize = () => {
  isMaximized.value = false
}
const onEnterFullScreen = () => {
  isFullScreen.value = true
}
const onLeaveFullScreen = () => {
  isFullScreen.value = false
}

const offMaximize = window.electron.ipcRenderer.on('mt::window-maximize', onMaximize)
const offUnmaximize = window.electron.ipcRenderer.on('mt::window-unmaximize', onUnmaximize)
const offEnterFullScreen = window.electron.ipcRenderer.on(
  'mt::window-enter-full-screen',
  onEnterFullScreen
)
const offLeaveFullScreen = window.electron.ipcRenderer.on(
  'mt::window-leave-full-screen',
  onLeaveFullScreen
)

onBeforeUnmount(() => {
  offMaximize()
  offUnmaximize()
  offEnterFullScreen()
  offLeaveFullScreen()
})
</script>

<style scoped>
.title-bar-editor-bg {
  flex: none;
  background: var(--editorBgColor);
}
.title-bar {
  -webkit-app-region: drag;
  user-select: none;
  background: transparent;
  height: var(--titleBarHeight);
  box-sizing: border-box;
  color: var(--editorColor50);
  position: relative;
  z-index: 2;
  transition: color 0.4s ease-in-out;
  cursor: default;
}
.active {
  color: var(--editorColor);
}
img {
  height: 90%;
  margin-top: 1px;
  vertical-align: top;
}
.title {
  padding: 0 190px;
  height: 100%;
  line-height: var(--titleBarHeight);
  font-size: 14px;
  text-align: center;
  transition: all 0.25s ease-in-out;
  & .filename {
    transition: all 0.25s ease-in-out;
  }
  &::after {
    content: '';
    position: absolute;
    top: 0;
    height: 1px;
    width: 100%;
    z-index: 1;
    -webkit-app-region: no-drag;
  }
}
div.title > span {
  display: flex;
  align-items: baseline;
  justify-content: center;
}

.path {
  direction: ltr;
  display: flex;
  white-space: nowrap;
  min-width: 0;
}

.path-viewport {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  overflow: clip;
}

.path-content {
  flex: none;
}

/* Keep bidirectional folder names and their separators in path order. */
.path-content > span {
  unicode-bidi: isolate;
}

/* On Wayland, keep native drag space above and below the text's hover target. */
.path-overflowing.path-dom-hover {
  margin-block: 6px;
  line-height: calc(var(--titleBarHeight) - 12px);
  -webkit-app-region: no-drag;
}

.path-overflowing .path-content {
  animation: scroll-title-path var(--path-scroll-duration) linear infinite;
}

.path-overflowing:is(.path-hovered, .path-dom-hover:hover) .path-content {
  animation: none;
}

.path-overflowing:is(.path-hovered, .path-dom-hover:hover)::before {
  content: '...';
  margin-right: 2px;
}

.path-hovered .filename.isOsx {
  -webkit-app-region: no-drag;
}

@keyframes scroll-title-path {
  from {
    transform: translateX(var(--path-overflow));
  }
  to {
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .path-overflowing .path-content {
    animation: none;
  }
  .path-overflowing::before {
    content: '...';
    margin-right: 2px;
  }
}

.title-bar .title .filename.isOsx:hover {
  color: var(--themeColor);
}

.active .save-dot {
  flex: none;
  margin-right: 0.25rem;
  width: 8px;
  height: 8px;
  display: inline-block;
  border-radius: 50%;
  background: var(--highlightThemeColor);
  opacity: 0.7;
  visibility: hidden;
}
.active .save-dot.show {
  visibility: visible;
}
.title:hover {
  color: var(sideBarTitleColor);
}

.has-menubar {
  display: flex;
  align-items: center;
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--sideBarBgColor), var(--editorBgColor)),
    var(--editorColor) 7%
  );
}
.has-menubar .title {
  flex: 1;
  min-width: 32px;
  padding: 0 12px;
  overflow: hidden;
}
.has-menubar .title::after {
  display: none;
}
.statistics-toolbar {
  flex: none;
  padding-left: 8px;
  height: 100%;
  display: flex;
  align-items: center;
}
.has-menubar .window-controls {
  position: static;
  flex: none;
}
@media (max-width: 900px) {
  .statistics-toolbar :deep(.document-statistics-trigger__label) {
    display: none;
  }
}
@media (max-width: 700px) {
  .has-menubar .title {
    padding: 0;
  }
  .has-menubar .title > span {
    visibility: hidden;
  }
}
.right-toolbar {
  height: 100%;
  position: absolute;
  top: 0;
  right: 0;
  width: 190px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  & .item {
    margin-right: 10px;
  }
}

.title-no-drag {
  -webkit-app-region: no-drag;
}
.frameless-titlebar-button {
  position: relative;
  display: block;
  width: 46px;
  height: var(--titleBarHeight);
  color: var(--editorColor);
}
.window-controls {
  width: 138px;
}
.frameless-titlebar-button > span {
  position: absolute;
  display: inline-flex;
  top: 50%;
  left: 50%;
  transform: translateX(-50%) translateY(-50%);
}
.frameless-titlebar-close:hover {
  background-color: rgb(228, 79, 79);
}
.frameless-titlebar-minimize:hover,
.frameless-titlebar-toggle:hover {
  background-color: var(--editorColor10);
}
.frameless-titlebar-button svg {
  fill: currentColor;
}
.frameless-titlebar-close:hover svg {
  fill: #ffffff;
}
</style>
