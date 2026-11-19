<template>
  <div
    class="side-bar-toc"
    @dragstart.capture="startDrag"
    @dragover.capture="dragOver"
    @dragleave.capture="leaveDrag"
    @drop.capture="dropSection"
    @dragend.capture="finishDrag"
    :class="[{ 'side-bar-toc-overflow': !wordWrapInToc, 'side-bar-toc-wordwrap': wordWrapInToc }]"
  >
    <el-tree
      v-if="keyedToc.length"
      :key="currentFile?.id"
      ref="tocTreeRef"
      :data="keyedToc"
      node-key="key"
      :default-expanded-keys="expandedKeys"
      :auto-expand-parent="false"
      highlight-current
      :props="defaultProps"
      :expand-on-click-node="false"
      :indent="10"
      :icon="ArrowRight"
      @node-click="handleClick"
      @node-expand="onExpand"
      @node-collapse="onCollapse"
    >
      <!-- Element Plus escapes `data.label`, so showing the heading HTML needs a
           scoped slot; re-add the label wrapper the default renderer would have
           made so the outline CSS keeps applying. -->
      <template #default="{ data }">
        <!-- eslint-disable vue/no-v-html -- sanitized by labelHtmlOf -->
        <span
          class="el-tree-node__label"
          :draggable="!currentFile?.readOnly"
          :class="dropMark && dropMark.key === data.key ? 'toc-drop-' + dropMark.side : undefined"
          :data-toc-key="data.key"
          :title="plainLabel(data)"
          v-html="labelHtmlOf(data)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </template>
    </el-tree>
    <p
      v-else
      class="outline-empty"
      role="status"
    >
      <span>{{ t('sideBar.toc.empty') }}</span>
      <span class="outline-empty-hint">{{ t('sideBar.toc.emptyHint') }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { documentViewChanged } from '@/services/documentViewState'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { deriveKeyedToc, type KeyedTocNode } from '@/util/tocKeys'
import { sectionCuts, type DropSide, type OutlineMoveSession } from '@/util/outlineMove'
import { sanitize, TOC_DOMPURIFY_CONFIG } from '@/util/dompurify'
import bus from '../../bus'
import { storeToRefs } from 'pinia'
import { ArrowRight } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { TreeInstance } from 'element-plus'

const { t } = useI18n()
const props = defineProps<{ visible?: boolean }>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const tocTreeRef = ref<TreeInstance | null>(null)
// Heading updates during a TOC jump describe the animation's intermediate
// sections; they must not move the outline the user is browsing.
let preserveOutlinePosition = false
const resumeFollowingDocument = (event: Event): void => {
  if (event.target instanceof Element && event.target.closest('.document-body')) {
    preserveOutlinePosition = false
  }
}
const navigationEvents = ['wheel', 'pointerdown', 'keydown'] as const
onMounted(() => {
  for (const event of navigationEvents) {
    document.addEventListener(event, resumeFollowingDocument, { capture: true, passive: true })
  }
})
onBeforeUnmount(() => {
  for (const event of navigationEvents) {
    document.removeEventListener(event, resumeFollowingDocument, true)
  }
})

const defaultProps = {
  children: 'children',
  label: 'label'
}

interface TocNodeData {
  label?: unknown
  labelHtml?: unknown
}

const plainLabel = (data: TocNodeData): string =>
  typeof data.label === 'string' ? data.label : ''

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const labelHtmlOf = (data: TocNodeData): string => {
  const html = typeof data.labelHtml === 'string' ? data.labelHtml : ''
  return html ? sanitize(html, TOC_DOMPURIFY_CONFIG) : escapeHtml(plainLabel(data))
}

const { toc, currentFile } = storeToRefs(editorStore)
const { wordWrapInToc } = storeToRefs(preferencesStore)

// Stable per-node key so el-tree preserves the user's expand/collapse state
// across content edits (#3028) and tab switches (#3791). See deriveKeyedToc.
const keyedToc = computed<KeyedTocNode[]>(() => deriveKeyedToc(toc.value))

let drag: { session: OutlineMoveSession; source: number; fileId: string; sourceMode: boolean; toc: typeof toc.value } | undefined
const dropMark = ref<{ key: string; side: DropSide }>()

function dragRow(event: DragEvent) {
  const row = event.target instanceof Element ? event.target.closest('.el-tree-node__content') : null
  const key = row?.querySelector<HTMLElement>('[data-toc-key]')?.dataset.tocKey
  const node = key ? tocTreeRef.value?.getNode(key) : undefined
  if (!row || !node || !key) return
  const index = editorStore.listToc.findIndex(item => item.slug === node.data.slug)
  if (index >= 0) return { row, key, index }
}

function finishDrag() {
  drag = undefined
  dropMark.value = undefined
}

function startDrag(event: DragEvent) {
  finishDrag()
  const target = dragRow(event)
  const file = currentFile.value
  if (!target || !file || file.readOnly || !event.dataTransfer) return
  bus.emit('begin-outline-move', (session: OutlineMoveSession) => {
    drag = { session, source: target.index, fileId: file.id, sourceMode: preferencesStore.sourceCode, toc: toc.value }
  })
  if (!drag) {
    event.preventDefault()
    return
  }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-autumnmark-section', target.key)
}

function dropTarget(event: DragEvent) {
  if (!drag || drag.fileId !== currentFile.value?.id || currentFile.value.readOnly ||
      drag.sourceMode !== preferencesStore.sourceCode || drag.toc !== toc.value) return
  const target = dragRow(event)
  if (!target) return
  const rect = target.row.getBoundingClientRect()
  const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  const cuts = sectionCuts(drag.session, drag.source, target.index, side)
  if (cuts) return { key: target.key, side, cuts } as const
}

function dragOver(event: DragEvent) {
  if (!drag) return
  event.preventDefault()
  const target = dropTarget(event)
  dropMark.value = target
  if (event.dataTransfer) event.dataTransfer.dropEffect = target ? 'move' : 'none'
}

function leaveDrag(event: DragEvent) {
  if (!(event.relatedTarget instanceof Node && (event.currentTarget as Element).contains(event.relatedTarget))) {
    dropMark.value = undefined
  }
}

function dropSection(event: DragEvent) {
  if (!drag) return
  event.preventDefault()
  event.stopPropagation()
  const target = dropTarget(event)
  const { session } = drag
  finishDrag()
  if (target) session.apply(target.cuts)
}

const collapsedKeys = computed(() => new Set(currentFile.value?.tocCollapsedKeys ?? []))
let restoringTree = false
watch(() => currentFile.value?.id, () => {
  preserveOutlinePosition = false
})

const onCollapse = (data: { key?: string }): void => {
  if (restoringTree || !currentFile.value || !data.key) return
  currentFile.value.tocCollapsedKeys = [...new Set(collapsedKeys.value).add(data.key)]
  documentViewChanged()
}

const onExpand = (data: { key?: string }): void => {
  if (restoringTree || !currentFile.value || !data.key) return
  const next = new Set(collapsedKeys.value)
  next.delete(data.key)
  currentFile.value.tocCollapsedKeys = [...next]
  documentViewChanged()
}

const branchKeys = computed(() => {
  const keys: string[] = []
  const visit = (nodes: KeyedTocNode[]): void => {
    for (const node of nodes) {
      if (node.children.length) keys.push(node.key)
      visit(node.children)
    }
  }
  visit(keyedToc.value)
  return keys
})
const canToggleAll = computed(() => branchKeys.value.length > 0)
const allCollapsed = computed(() => keyedToc.value.every(node =>
  !node.children.length || collapsedKeys.value.has(node.key)
))
const setAllExpanded = (expanded: boolean): void => {
  if (!currentFile.value || !canToggleAll.value) return
  currentFile.value.tocCollapsedKeys = expanded ? [] : [...branchKeys.value]
  documentViewChanged()
}
const toggleAll = (): void => setAllExpanded(allCollapsed.value)

defineExpose({ canToggleAll, allCollapsed, setAllExpanded, toggleAll })

// Hidden descendants keep their own state, without expanding their ancestors.
const expandedKeys = computed<string[]>(() => {
  const keys: string[] = []
  const walk = (nodes: KeyedTocNode[]): void => {
    for (const node of nodes) {
      if (!collapsedKeys.value.has(node.key)) keys.push(node.key)
      walk(node.children)
    }
  }
  walk(keyedToc.value)
  return keys
})

watch([() => currentFile.value?.id, keyedToc, collapsedKeys], async() => {
  const tabId = currentFile.value?.id
  const nodes = keyedToc.value
  await nextTick()
  if (tabId !== currentFile.value?.id || nodes !== keyedToc.value) return
  const tree = tocTreeRef.value
  if (!tree) return

  // default-expanded-keys only expands nodes; a rebuilt tree also needs collapses.
  const restore = (items: KeyedTocNode[]): void => {
    for (const item of items) {
      const node = tree.getNode(item.key)
      if (node) {
        const expanded = !collapsedKeys.value.has(item.key)
        if (node.expanded !== expanded) {
          if (expanded) node.expand(undefined, false)
          else node.collapse()
        }
      }
      restore(item.children)
    }
  }
  restoringTree = true
  try {
    restore(nodes)
  } finally {
    restoringTree = false
  }
}, { flush: 'post', immediate: true })

// The store names the caret's heading by engine slug; el-tree keys its nodes by
// githubSlug. Both sit on the same node, so one resolves to the other.
const activeNodeKey = computed<string>(() => {
  const slug = editorStore.activeHeadingSlug
  if (typeof slug !== 'string') return ''
  const findKey = (nodes: KeyedTocNode[]): string => {
    for (const node of nodes) {
      if (node.slug === slug) return node.key
      const found = findKey(node.children)
      if (found) return found
    }
    return ''
  }
  return findKey(keyedToc.value)
})

// The current-node-key prop also expands ancestors, so synchronize only through
// the setter to preserve user-collapsed sections during heading changes.
const revealActiveHeading = async(): Promise<void> => {
  await nextTick()
  const tree = tocTreeRef.value
  tree?.setCurrentKey(activeNodeKey.value || undefined, false)
  if (!tree || props.visible === false) return
  const treeElement = tree.$el as HTMLElement
  let node = activeNodeKey.value ? tree.getNode(activeNodeKey.value) : null
  for (let ancestor = node?.parent; ancestor?.level; ancestor = ancestor.parent) {
    if (!ancestor.expanded) node = ancestor
  }
  if (!node) return
  tree.setCurrentKey(node.key, false)
  if (preserveOutlinePosition) return
  const label = Array.from(treeElement.querySelectorAll<HTMLElement>('[data-toc-key]'))
    .find(element => element.dataset.tocKey === node.key)
  if (!label) return
  const bounds = label.getBoundingClientRect()
  const viewport = treeElement.getBoundingClientRect()
  if (bounds.top < viewport.top) treeElement.scrollTop += bounds.top - viewport.top - 8
  else if (bounds.bottom > viewport.bottom) treeElement.scrollTop += bounds.bottom - viewport.bottom + 8
}
watch([activeNodeKey, () => props.visible, keyedToc, expandedKeys], revealActiveHeading, { flush: 'post' })

const handleClick = (data: { slug?: unknown }): void => {
  // Skip headings without usable slugs; the editor resolves scroll targets by slug.
  if (typeof data.slug !== 'string' || data.slug.length === 0) return
  preserveOutlinePosition = true
  bus.emit('scroll-to-header', data.slug)
}
</script>

<style>
.side-bar-toc {
  height: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.outline-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 48px 0 0;
  padding: 24px 12px;
  font-size: 13px;
  text-align: center;
  color: var(--sideBarColor);
}

.outline-empty-hint {
  font-size: 12px;
  line-height: 1.6;
}

.side-bar-toc .el-tree-node {
  margin-top: 8px;
}

.side-bar-toc .el-tree {
  background: transparent;
  color: var(--sideBarColor);
  flex: 1;
  min-height: 0;
  scrollbar-width: none;
}

.side-bar-toc .el-tree::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* The scoped slot replaced Element Plus's `<el-text truncated>` label, so its
   truncation is re-declared here. `color: inherit` overrides the gray that
   `el-text` imposed, which beat the themed color from `.el-tree` (#5094). */
.side-bar-toc .el-tree-node__label {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  color: inherit;
  align-self: center;
  overflow-wrap: break-word;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-bar-toc .el-tree-node__expand-icon {
  color: var(--sideBarIconColor);
}

.side-bar-toc .el-tree-node:focus > .el-tree-node__content {
  background-color: var(--sideBarItemHoverBgColor);
}

.side-bar-toc .el-tree-node__content:hover {
  background: var(--sideBarItemHoverBgColor);
}

/* Element Plus paints `.is-current` from a selector carrying
   `.el-tree--highlight-current`, so overriding it needs that class too. */
.side-bar-toc .el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content {
  background-color: var(--sideBarItemHoverBgColor);
  color: var(--themeColor);
}

.side-bar-toc > li {
  font-size: 14px;
  margin-bottom: 15px;
  cursor: pointer;
}
.side-bar-toc-overflow .el-tree {
  overflow: auto;
}
.side-bar-toc-wordwrap .el-tree {
  overflow-x: hidden;
  overflow-y: auto;
}

.side-bar-toc-wordwrap .el-tree-node__content {
  white-space: normal;
  height: auto;
  min-height: 26px;
}

.side-bar-toc-wordwrap .el-tree-node__content .el-tree-node__label {
  white-space: normal;
  text-overflow: clip;
  overflow: visible;
}

.side-bar-toc .el-tree-node__label strong {
  font-weight: 700;
}

.side-bar-toc .el-tree-node__label[draggable="true"] {
  flex: 1;
  cursor: grab;
}
.side-bar-toc .el-tree-node__content:has(.toc-drop-before) {
  box-shadow: inset 0 2px var(--themeColor);
}
.side-bar-toc .el-tree-node__content:has(.toc-drop-after) {
  box-shadow: inset 0 -2px var(--themeColor);
}

.side-bar-toc .el-tree-node__label em {
  font-style: italic;
}

.side-bar-toc .el-tree-node__label del {
  opacity: 0.65;
  text-decoration: line-through;
}

.side-bar-toc .el-tree-node__label mark {
  padding: 0 2px;
  color: inherit;
  background: var(--highlightColor);
  border-radius: 2px;
}

.side-bar-toc .el-tree-node__label code {
  padding: 0 3px;
  font-family: 'DejaVu Sans Mono', 'Source Code Pro', 'Droid Sans Mono', Consolas, monospace;
  font-size: 0.9em;
  color: var(--codeBlockColor);
  background: var(--codeBgColor);
  border-radius: 3px;
  /* Prism sets `white-space: normal` on every non-`pre` code element, which
     overrides the label's nowrap setting and makes the row overflow. */
  white-space: inherit;
}

.side-bar-toc .el-tree-node__label sup,
.side-bar-toc .el-tree-node__label sub {
  /* Keeps a raised superscript from growing the row. */
  line-height: 0;
}
</style>
