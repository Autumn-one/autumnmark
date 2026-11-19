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
          @click="selectTab(tab.view)"
        >
          {{ t(tab.label) }}
        </button>
      </div>
      <icon-tooltip
        v-if="rightColumn === 'files'"
        :content="t('sideBar.icons.search')"
      >
        <button
          ref="searchButton"
          type="button"
          class="plain-button search-button"
          :aria-label="t('sideBar.icons.search')"
          @click="openSearch"
        >
          <Search aria-hidden="true" />
        </button>
      </icon-tooltip>
      <icon-tooltip
        v-else-if="editorStore.listToc.length"
        :content="bulkLabel"
      >
        <button
          type="button"
          class="plain-button outline-bulk-toggle"
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
    <div class="sidebar-content">
      <div
        v-show="rightColumn === 'files'"
        id="sidebar-panel-files"
        class="sidebar-panel"
        role="tabpanel"
        aria-labelledby="sidebar-tab-files"
      >
        <tree :tabs="tabs" />
      </div>
      <div
        v-show="rightColumn === 'outline'"
        id="sidebar-panel-outline"
        class="sidebar-panel outline-panel"
        role="tabpanel"
        aria-labelledby="sidebar-tab-outline"
        tabindex="0"
      >
        <toc
          ref="tocRef"
          :visible="showToc"
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
          @click="projectStore.OPEN_SETTING_WINDOW()"
        >
          <Setting aria-hidden="true" />
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

import { Search, Setting, Plus } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import Tree from './tree.vue'
import Toc from './toc.vue'
import SideBarSearch from './search.vue'
import IconTooltip from '@/components/iconTooltip/index.vue'
import { storeToRefs } from 'pinia'
import bus from '@/bus'

const { t } = useI18n()
const searchButton = ref<HTMLButtonElement | null>(null)
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()
const tocRef = ref<InstanceType<typeof Toc> | null>(null)
const sidebarTabs = [
  { view: 'files', label: 'sideBar.icons.files' },
  { view: 'outline', label: 'sideBar.toc.title' }
] as const
type SidebarTab = (typeof sidebarTabs)[number]['view']
const bulkLabel = computed(() =>
  t(tocRef.value?.allCollapsed ? 'sideBar.toc.expandAll' : 'sideBar.toc.collapseAll')
)

const dragBar = ref<HTMLDivElement | null>(null)

const draggedSideBarWidth = ref<number | null>(null)

const { rightColumn, showSideBar, showToc, effectiveSideBarWidth, sideBarMaximumWidth } =
  storeToRefs(layoutStore)

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
  let view: SidebarTab = rightColumn.value === 'files' ? 'outline' : 'files'
  if (event.key === 'Home') view = 'files'
  if (event.key === 'End') view = 'outline'
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

.sidebar-header,
.sidebar-footer {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 4px 8px;
  -webkit-app-region: no-drag;
}

.sidebar-header {
  height: var(--editorToolbarHeight);
  padding-block: 0;
  padding-inline-start: 10px;
  justify-content: space-between;
  gap: 6px;
}

.add-folder-button {
  margin-left: auto;
}

.sidebar-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  box-sizing: border-box;
  height: 28px;
  min-width: 126px;
  padding: 2px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--sideBarBgColor), var(--editorColor) 9%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--editorColor) 5%, transparent);
}

.sidebar-header > .plain-button,
.sidebar-footer button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: var(--sideBarIconColor);
}

.sidebar-header > button:hover:not(:disabled),
.sidebar-tab[aria-selected='false']:hover,
.sidebar-footer button:hover {
  background: var(--sideBarItemHoverBgColor);
}

.outline-bulk-toggle:disabled {
  opacity: 0.4;
}

.sidebar-header .sidebar-tab {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  padding: 0 12px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--editorColor60);
}

.sidebar-tab[aria-selected='true'] {
  color: var(--editorColor80);
  background: var(--editorBgColor);
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  font-weight: 600;
}

.outline-panel:focus-visible {
  outline: 1px solid var(--focusColor);
  outline-offset: -1px;
}

.sidebar-header svg,
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
  padding-inline: 8px;
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
