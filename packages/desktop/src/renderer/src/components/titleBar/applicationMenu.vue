<template>
  <div
    ref="menubar"
    class="application-menubar"
    role="menubar"
    :aria-label="t('titleBar.applicationMenu')"
    @focusout="handleFocusOut"
  >
    <button
      v-for="(category, index) in categories"
      :key="category.index"
      type="button"
      role="menuitem"
      class="plain-button application-menubar__item"
      :class="{ 'is-open': openIndex === category.index }"
      :disabled="!category.enabled"
      :tabindex="focusedIndex === index ? 0 : -1"
      aria-haspopup="menu"
      :aria-expanded="openIndex === category.index"
      @mousedown.prevent
      @focus="focusedIndex = index"
      @click="openMenu(category, $event)"
      @keydown="handleKeydown($event, index)"
    >
      {{ displayLabel(category.label) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApplicationMenuCategory } from '@shared/types/menu'

const { t, locale } = useI18n()
const categories = ref<ApplicationMenuCategory[]>([])
const menubar = ref<HTMLElement | null>(null)
const focusedIndex = ref(0)
const openIndex = ref<number | null>(null)

interface MenuFocus {
  element: HTMLElement
  documentId?: string
  selection?: { range: Range; backward: boolean }
}

let altPending = false
let returnFocus: MenuFocus | undefined

const displayLabel = (label: string): string =>
  label.replace(/\(&.\)/g, '').replace(/&&|&/g, (marker) => (marker === '&&' ? '&' : ''))

const loadCategories = async (): Promise<void> => {
  try {
    categories.value = await window.electron.windowControl.getApplicationMenuCategories()
    if (!categories.value[focusedIndex.value]?.enabled) {
      focusedIndex.value = categories.value.findIndex((category) => category.enabled)
    }
  } catch (error) {
    console.error('Failed to load application menu', error)
  }
}

watch(locale, loadCategories, { immediate: true })
const offCategoriesChanged = window.electron.ipcRenderer.on(
  'mt::menu::application-categories-changed',
  loadCategories
)

const rememberFocus = (element: Element | null): void => {
  returnFocus = undefined
  if (!(element instanceof HTMLElement) || element === document.body) return

  const documentId = element.closest<HTMLElement>('.document-body')?.dataset.documentId
  returnFocus = { element, documentId }
  const editor = element.closest('.editor-component')
  const selection = document.getSelection()
  if (!editor || !selection?.rangeCount) return

  const range = selection.getRangeAt(0)
  if (editor.contains(range.commonAncestorContainer)) {
    returnFocus.selection = {
      range: range.cloneRange(),
      backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset
    }
  }
}

const leaveMenu = (): void => {
  const previous = returnFocus
  returnFocus = undefined
  const active = document.activeElement
  if (previous?.element.isConnected &&
      previous.documentId === previous.element.closest<HTMLElement>('.document-body')?.dataset.documentId) {
    const { element, selection } = previous
    element.focus({ preventScroll: true })
    if (document.activeElement === element) {
      if (selection && element.closest('.editor-component')?.contains(selection.range.commonAncestorContainer)) {
        const { startContainer, startOffset, endContainer, endOffset } = selection.range
        document.getSelection()?.setBaseAndExtent(
          selection.backward ? endContainer : startContainer,
          selection.backward ? endOffset : startOffset,
          selection.backward ? startContainer : endContainer,
          selection.backward ? startOffset : endOffset
        )
      }
      return
    }
  }

  const editors = document.querySelectorAll<HTMLElement>(
    '.document-body :is(.CodeMirror textarea, .editor-wrapper:not(.source) .editor-component)'
  )
  const editor = Array.from(editors).find(element => element.getClientRects().length && !element.closest('[inert]'))
  editor?.focus({ preventScroll: true })
  if (document.activeElement === active && active instanceof HTMLElement) active.blur()
}

const handleFocusOut = (event: FocusEvent): void => {
  if (event.relatedTarget instanceof Node && !menubar.value?.contains(event.relatedTarget)) {
    returnFocus = undefined
  }
}

const blocksAlt = (target: Element | null): boolean => {
  if (openIndex.value !== null) return true
  if (target?.closest('input, textarea, select') && !target.closest('.CodeMirror')) return true
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
  return Array.from(dialogs).some(dialog => dialog.getClientRects().length && getComputedStyle(dialog).visibility === 'visible')
}

const isPlainAlt = (event: KeyboardEvent): boolean =>
  event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
  !event.isComposing && !event.getModifierState('AltGraph')

const cancelAlt = (): void => { altPending = false }

const handleAltDown = (event: KeyboardEvent): void => {
  if (event.repeat && isPlainAlt(event)) return
  altPending = isPlainAlt(event) && !blocksAlt(document.activeElement)
}

const handleAltUp = (event: KeyboardEvent): void => {
  if (event.key !== 'Alt') return
  const wasPending = altPending
  cancelAlt()
  const active = document.activeElement
  if (!wasPending || !isPlainAlt(event) || blocksAlt(active)) return

  if (menubar.value?.contains(active)) {
    event.preventDefault()
    leaveMenu()
    return
  }

  const first = menubar.value?.querySelector<HTMLButtonElement>('button:enabled')
  if (first) {
    event.preventDefault()
    rememberFocus(active)
    first.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleAltDown, true)
  window.addEventListener('keyup', handleAltUp, true)
  window.addEventListener('pointerdown', cancelAlt, true)
  window.addEventListener('blur', cancelAlt)
})
onBeforeUnmount(() => {
  offCategoriesChanged()
  window.removeEventListener('keydown', handleAltDown, true)
  window.removeEventListener('keyup', handleAltUp, true)
  window.removeEventListener('pointerdown', cancelAlt, true)
  window.removeEventListener('blur', cancelAlt)
})

const openMenu = async (category: ApplicationMenuCategory, event: Event): Promise<void> => {
  if (!category.enabled || openIndex.value !== null) return
  const button = event.currentTarget as HTMLButtonElement
  const { left, bottom } = button.getBoundingClientRect()
  openIndex.value = category.index
  try {
    await window.electron.windowControl.popupApplicationMenuCategory(category.index, {
      x: left,
      y: bottom
    })
  } catch (error) {
    console.error('Failed to open application menu', error)
  } finally {
    openIndex.value = null
  }
}

const handleKeydown = (event: KeyboardEvent, index: number): void => {
  if (openIndex.value !== null) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    leaveMenu()
    return
  }
  const buttons = Array.from(
    menubar.value?.querySelectorAll<HTMLButtonElement>('button:enabled') ?? []
  )
  const current = buttons.indexOf(event.currentTarget as HTMLButtonElement)
  let next: number
  switch (event.key) {
    case 'ArrowRight':
      next = (current + 1) % buttons.length
      break
    case 'ArrowLeft':
      next = (current + buttons.length - 1) % buttons.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = buttons.length - 1
      break
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      void openMenu(categories.value[index], event)
      return
    default:
      return
  }
  event.preventDefault()
  buttons[next]?.focus()
}
</script>

<style scoped>
.application-menubar {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.application-menubar__item {
  flex: none;
  height: 26px;
  padding: 0 9px;
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
  white-space: nowrap;
}

.application-menubar__item:not(:disabled):hover,
.application-menubar__item.is-open {
  background: var(--editorColor10);
}

.application-menubar__item:disabled {
  color: var(--editorColor40);
  cursor: default;
}

@media (max-width: 900px) {
  .application-menubar__item {
    padding: 0 6px;
  }
}

@media (max-width: 650px) {
  .application-menubar__item {
    padding-inline: 3px;
  }
}
</style>
