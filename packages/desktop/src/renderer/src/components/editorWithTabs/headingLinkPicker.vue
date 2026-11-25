<template>
  <Teleport to="body">
    <div ref="panel" class="heading-link-picker" :style="position" @mousedown.prevent>
      <ul v-if="matches.length" role="listbox" :aria-label="t('sideBar.toc.title')">
        <li
          v-for="(item, index) in matches" :key="item.anchor"
          role="option" :aria-selected="index === active"
          @mouseenter="active = index" @click="choose(index)"
        >
          <span>{{ item.content || item.anchor }}</span>
          <small>#{{ item.anchor }}</small>
        </li>
      </ul>
      <div v-else role="status">{{ loading ? t('commandPalette.loadingHeadings') : t('commandPalette.noResults') }}</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getMarkdownOutline } from '@muyajs/core'
import { headingLinkFile, type HeadingLinkRequest } from '@/util/headingLinks'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const props = defineProps<{ request: HeadingLinkRequest }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const panel = ref<HTMLElement>()
const active = ref(0)
const loading = ref(false)
const remote = shallowRef<{ content: string; anchor: string }[]>([])
const filename = computed(() => props.request.file)
const target = computed(() => headingLinkFile(filename.value, editor.currentFile?.pathname))
const openTab = computed(() => {
  const path = target.value?.pathname
  return path && editor.tabs.find(tab => tab.pathname && window.fileUtils.isSamePathSync(tab.pathname, path))
})

watch([target, () => openTab.value && openTab.value.markdown], async([file, draft], _, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  remote.value = []
  loading.value = false
  if (!file) return
  loading.value = true
  try {
    const markdown = typeof draft === 'string' ? draft : await window.electron.ipcRenderer.invoke(
      'mt::read-heading-link-document', file.pathname, preferences.autoGuessEncoding
    )
    if (current && markdown != null) remote.value = getMarkdownOutline(markdown, preferences).headings
  } catch {
    if (current) remote.value = []
  } finally {
    if (current) loading.value = false
  }
}, { immediate: true })

const matches = computed(() => {
  const headings = props.request.file ? remote.value : editor.listToc
  const query = props.request.query.trim().toLowerCase()
  return headings.flatMap(item => {
    const anchor = item.anchor
    const content = item.content ?? ''
    return anchor && (anchor.includes(query) || content.toLowerCase().includes(query)) ? [{ anchor, content }] : []
  })
})
watch(matches, () => { active.value = 0 })

const position = computed(() => {
  const { left, top, bottom } = props.request.rect
  return {
    left: Math.max(4, Math.min(left, window.innerWidth - 324)) + 'px',
    ...(window.innerHeight - bottom < 200 && top > 200
      ? { bottom: window.innerHeight - top + 4 + 'px' } : { top: bottom + 4 + 'px' })
  }
})
function choose(index: number) {
  const item = matches.value[index]
  if (item) props.request.apply((target.value?.href ?? '') + '#' + item.anchor, item.content || item.anchor)
  emit('close')
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (!['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return
  if (event.key !== 'Escape' && !matches.value.length) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'Enter') choose(active.value)
  else {
    const count = matches.value.length
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    nextTick(() => panel.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }
}
function dismissOutside(event: Event) {
  if (!(event.target instanceof Node && panel.value?.contains(event.target))) emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', keydown, true)
  document.addEventListener('pointerdown', dismissOutside, true)
  document.addEventListener('focusin', dismissOutside, true)
  window.addEventListener('blur', dismissOutside)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown, true)
  document.removeEventListener('pointerdown', dismissOutside, true)
  document.removeEventListener('focusin', dismissOutside, true)
  window.removeEventListener('blur', dismissOutside)
})
</script>

<style scoped>
.heading-link-picker {
  position: fixed;
  z-index: 2100;
  width: min(320px, calc(100vw - 8px));
  max-height: min(240px, 42vh);
  overflow: auto;
  background: var(--floatBgColor);
  color: var(--editorColor);
  border: 1px solid var(--editorColor10);
  border-radius: 6px;
  box-shadow: 0 4px 16px #0002;
  font-size: 13px;
}
ul { margin: 0; padding: 4px; list-style: none; }
li, [role="status"] { padding: 6px 9px; }
li { cursor: pointer; overflow-wrap: anywhere; }
li[aria-selected="true"] { background: var(--floatHoverColor); }
small { display: block; opacity: 0.7; }
</style>
