<template>
  <div
    v-show="showSideBar"
    class="side-bar"
    :style="{ width: `${finalSideBarWidth}px` }"
  >
    <div
      v-if="rightColumn !== 'search'"
      class="sidebar-header"
    >
      <div
        class="sidebar-tabs"
        role="tablist"
        :aria-label="t('preferences.general.sidebar.title')"
        @keydown.left.right.home.end.prevent="navigateTabs"
      >
        <button
          v-for="tab in sidebarTabs"
          :id="`sidebar-tab-${tab.view}`"
          :key="tab.view"
          type="button"
          class="plain-button sidebar-tab"
          role="tab"
          :aria-selected="rightColumn === tab.view"
          :aria-controls="`sidebar-panel-${tab.view}`"
          :tabindex="rightColumn === tab.view ? 0 : -1"
          :title="t(tab.label)"
          @click="selectTab(tab.view)"
        >
          <component
            :is="tab.icon"
            class="sidebar-tab-icon"
            aria-hidden="true"
          />
          <span class="text-overflow">{{ t(tab.label) }}</span>
        </button>
      </div>
    </div>
    <div class="sidebar-content">
      <div
        v-show="rightColumn === 'files'"
        id="sidebar-panel-files"
        class="sidebar-panel"
        role="tabpanel"
        aria-labelledby="sidebar-tab-files"
      >
        <tree :tabs="tabs">
          <template #search>
            <icon-tooltip :content="t('sideBar.icons.search')">
              <button
                ref="searchButton"
                type="button"
                class="plain-button sidebar-panel-action search-button"
                :aria-label="t('sideBar.icons.search')"
                @click="openSearch"
              >
                <Search aria-hidden="true" />
              </button>
            </icon-tooltip>
          </template>
        </tree>
      </div>
      <div
        v-show="rightColumn === 'outline'"
        id="sidebar-panel-outline"
        class="sidebar-panel outline-panel"
        role="tabpanel"
        aria-labelledby="sidebar-tab-outline"
        :tabindex="tocRef?.canToggleAll ? -1 : 0"
      >
        <div class="outline-heading">
          <h2>{{ t('sideBar.toc.title') }}</h2>
          <icon-tooltip
            v-if="editorStore.listToc.length"
            :content="bulkLabel"
          >
            <button
              type="button"
              class="plain-button sidebar-panel-action outline-bulk-toggle"
              :aria-label="bulkLabel"
              :disabled="!tocRef?.canToggleAll"
              @click="tocRef?.toggleAll()"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"
              >
                <path d="M8 4h12v12M4 8h12v12H4z" />
                <path :d="tocRef?.allCollapsed ? 'M7 14h6m-3-3v6' : 'M7 14h6'" />
              </svg>
            </button>
          </icon-tooltip>
        </div>
        <toc
          ref="tocRef"
          :visible="showToc"
        />
      </div>
      <div
        v-show="rightColumn === 'documentChat'"
        id="sidebar-panel-documentChat"
        class="sidebar-panel"
        role="tabpanel"
        aria-labelledby="sidebar-tab-documentChat"
      >
        <document-chat
          v-if="documentChatVisited"
          ref="documentChat"
          :read-markdown="readMarkdown"
          :edit-markdown="editMarkdown"
          @theme-preview="(theme, documentId) => emit('theme-preview', theme, documentId)"
        />
      </div>
      <side-bar-search
        v-if="rightColumn === 'search'"
        @back="returnToFiles"
      />
    </div>
    <div class="sidebar-footer">
      <icon-tooltip :content="t('sideBar.icons.settings')">
        <button
          type="button"
          class="plain-button settings-button"
          :aria-label="t('sideBar.icons.settings')"
          @pointerenter="prepareSettings"
          @focus="prepareSettings"
          @click="projectStore.OPEN_SETTING_WINDOW()"
        >
          <Setting aria-hidden="true" />
        </button>
      </icon-tooltip>
      <icon-tooltip
        :content="t('history.title')"
        placement="top"
      >
        <button
          type="button"
          class="plain-button history-button"
          :aria-label="t('history.title')"
          @click="emit('open-history')"
        >
          <Clock aria-hidden="true" />
        </button>
      </icon-tooltip>
      <icon-tooltip :content="t('menu.file.addFolder')">
        <button
          type="button"
          class="plain-button add-folder-button"
          :aria-label="t('menu.file.addFolder')"
          @click="projectStore.ASK_FOR_OPEN_PROJECT()"
        >
          <Plus aria-hidden="true" />
        </button>
      </icon-tooltip>
    </div>
    <div
      ref="dragBar"
      class="drag-bar"
      role="separator"
      tabindex="0"
      :aria-label="t('sideBar.resize')"
      aria-orientation="vertical"
      :aria-valuemin="220"
      :aria-valuemax="sideBarMaximumWidth"
      :aria-valuenow="finalSideBarWidth"
      @keydown.left.right.home.end.prevent="resizeWithKeyboard"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

import { ChatLineRound, Clock, FolderOpened, List, Plus, Search, Setting } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import Tree from './tree.vue'
import Toc from './toc.vue'
import SideBarSearch from './search.vue'
import DocumentChat from './documentChat.vue'
import type { LocalTheme } from '@shared/localTheme'
import type { EditMarkdown } from '@shared/markdownEdits'
import IconTooltip from '@/components/iconTooltip/index.vue'
import { storeToRefs } from 'pinia'
import bus from '@/bus'

const { t } = useI18n()
defineProps<{
  readMarkdown: (id: string) => string | undefined
  editMarkdown: EditMarkdown
}>()
const emit = defineEmits<{ 'theme-preview': [theme: LocalTheme | null, documentId?: string]; 'open-history': [] }>()
const documentChat = ref<InstanceType<typeof DocumentChat>>()
defineExpose({
  showHistoryTurn: (chatId: string, turnId: string) => documentChat.value?.showHistoryTurn(chatId, turnId)
})
const prepareSettings = (): void => {
  window.electron.ipcRenderer.send('mt::prepare-setting-window')
}
const searchButton = ref<HTMLButtonElement | null>(null)
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()
const tocRef = ref<InstanceType<typeof Toc> | null>(null)
const sidebarTabs = [
  { view: 'files', label: 'sideBar.icons.files', icon: FolderOpened },
  { view: 'outline', label: 'sideBar.toc.title', icon: List },
  { view: 'documentChat', label: 'documentChat.tab', icon: ChatLineRound }
] as const
type SidebarTab = (typeof sidebarTabs)[number]['view']
const bulkLabel = computed(() =>
  t(tocRef.value?.allCollapsed ? 'sideBar.toc.expandAll' : 'sideBar.toc.collapseAll')
)

const dragBar = ref<HTMLDivElement | null>(null)

const draggedSideBarWidth = ref<number | null>(null)

const { rightColumn, showSideBar, showToc, effectiveSideBarWidth, sideBarMaximumWidth } =
  storeToRefs(layoutStore)
const documentChatVisited = ref(false)
watch(rightColumn, view => {
  if (view === 'documentChat') documentChatVisited.value = true
}, { immediate: true })

const { tabs } = storeToRefs(editorStore)

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value || draggedSideBarWidth.value === null) return effectiveSideBarWidth.value
  return Math.min(sideBarMaximumWidth.value, Math.max(220, draggedSideBarWidth.value))
})

let stopDragging: (() => void) | undefined

onUnmounted(() => {
  stopDragging?.()
  bus.off('outline:set-all-expanded', setAllExpanded)
})

onMounted(() => {
  bus.on('outline:set-all-expanded', setAllExpanded)
  nextTick(() => {
    const dragBarEl = dragBar.value
    if (!dragBarEl) return
    let startX = 0
    let startWidth = 0

    const mouseUpHandler = (): void => {
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
      if (draggedSideBarWidth.value !== null) {
        layoutStore.SET_SIDE_BAR_WIDTH(draggedSideBarWidth.value)
        draggedSideBarWidth.value = null
      }
    }

    const mouseMoveHandler = (event: MouseEvent): void => {
      const offset = event.clientX - startX
      draggedSideBarWidth.value = startWidth + offset
    }

    const mouseDownHandler = (event: MouseEvent): void => {
      startX = event.clientX
      startWidth = finalSideBarWidth.value
      document.addEventListener('mousemove', mouseMoveHandler, false)
      document.addEventListener('mouseup', mouseUpHandler, false)
    }

    dragBarEl.addEventListener('mousedown', mouseDownHandler, false)
    stopDragging = () => {
      dragBarEl.removeEventListener('mousedown', mouseDownHandler, false)
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
    }
  })
})

const selectTab = (view: SidebarTab): void => {
  layoutStore.SET_LAYOUT({ rightColumn: view })
}

const navigateTabs = (event: KeyboardEvent): void => {
  const index = sidebarTabs.findIndex(tab => tab.view === rightColumn.value)
  const offset = event.key === 'ArrowLeft' ? -1 : 1
  let next = (index + offset + sidebarTabs.length) % sidebarTabs.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = sidebarTabs.length - 1
  const view = sidebarTabs[next].view
  selectTab(view)
  nextTick(() => document.getElementById(`sidebar-tab-${view}`)?.focus())
}

const resizeWithKeyboard = (event: KeyboardEvent): void => {
  let width = finalSideBarWidth.value + (event.key === 'ArrowLeft' ? -10 : 10)
  if (event.key === 'Home') width = 220
  if (event.key === 'End') width = sideBarMaximumWidth.value
  layoutStore.SET_SIDE_BAR_WIDTH(Math.min(sideBarMaximumWidth.value, width))
}

const setAllExpanded = (expanded: unknown): void => {
  const outline = tocRef.value
  if (typeof expanded !== 'boolean' || !outline?.canToggleAll) return
  layoutStore.SET_LAYOUT({ rightColumn: 'outline', showSideBar: true })
  outline.setAllExpanded(expanded)
}

const openSearch = (): void => {
  layoutStore.SET_LAYOUT({ rightColumn: 'search' })
}

const returnToFiles = (restoreFocus = true): void => {
  layoutStore.SET_LAYOUT({ rightColumn: 'files' })
  if (restoreFocus) nextTick(() => searchButton.value?.focus())
}
</script>

<style scoped>
.side-bar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 280px;
  min-width: 220px;
  box-sizing: border-box;
  position: relative;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 4px 8px;
  -webkit-app-region: no-drag;
}

.sidebar-header {
  height: var(--editorToolbarHeight);
  box-sizing: border-box;
  flex-shrink: 0;
  border-block-end: 1px solid var(--sideBarBorderColor);
  container-type: inline-size;
  -webkit-app-region: no-drag;
}

.add-folder-button {
  margin-left: auto;
}

.sidebar-tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  column-gap: 3px;
  height: 100%;
  padding-inline: 12px;
}

.sidebar-tab {
  position: relative;
  min-width: 0;
  gap: 4px;
  border-radius: 5px 5px 0 0;
  font-size: 13px;
  color: var(--sideBarColor);
}

.sidebar-tab > span {
  min-width: 0;
}

.sidebar-tab-icon {
  width: 15px;
  height: 15px;
  flex: none;
}

.sidebar-tab[aria-selected='true'] {
  color: color-mix(in srgb, var(--sideBarTitleColor) 80%, var(--themeColor));
  font-weight: 600;
}

.sidebar-tab[aria-selected='true']::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: -1px;
  width: 28px;
  height: 2px;
  margin-inline: auto;
  border-radius: 2px;
  background: color-mix(in srgb, var(--themeColor) 75%, var(--sideBarTitleColor));
}

@media (forced-colors: active) {
  .sidebar-tab[aria-selected='true']::after {
    forced-color-adjust: none;
    background: Highlight;
  }
}

@container (width < 270px) {
  .sidebar-tabs {
    padding-inline: 8px;
  }

  .sidebar-tab {
    font-size: 12px;
  }

  .sidebar-tab-icon {
    display: none;
  }
}

.sidebar-panel-action,
.sidebar-footer button {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: var(--sideBarIconColor);
}

.sidebar-panel-action {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}

.sidebar-panel-action:hover:not(:disabled),
.sidebar-tab[aria-selected='false']:hover,
.sidebar-footer button:hover {
  background: var(--sideBarItemHoverBgColor);
}

.outline-bulk-toggle:disabled {
  opacity: 0.4;
}

.outline-panel:focus-visible {
  outline: 1px solid var(--focusColor);
  outline-offset: -1px;
}

.sidebar-panel-action svg,
.sidebar-footer svg {
  width: 18px;
  height: 18px;
}

.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sidebar-panel {
  height: 100%;
}

.outline-panel {
  display: flex;
  flex-direction: column;
  padding-inline: 8px;
}

.outline-heading {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding-inline: 4px;
}

.outline-heading h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.outline-panel .side-bar-toc {
  flex: 1;
  min-height: 0;
}

.drag-bar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  width: 5px;
  cursor: col-resize;
  -webkit-app-region: no-drag;
}

.drag-bar:hover,
.drag-bar:focus-visible {
  box-shadow: inset -2px 0 var(--iconColor);
}
</style>
