<template>
  <div
    ref="menubar"
    class="application-menubar"
    role="menubar"
    :aria-label="t('titleBar.applicationMenu')"
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
import { ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApplicationMenuCategory } from '@shared/types/menu'

const { t, locale } = useI18n()
const categories = ref<ApplicationMenuCategory[]>([])
const menubar = ref<HTMLElement | null>(null)
const focusedIndex = ref(0)
const openIndex = ref<number | null>(null)

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
onBeforeUnmount(offCategoriesChanged)

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
</style>
