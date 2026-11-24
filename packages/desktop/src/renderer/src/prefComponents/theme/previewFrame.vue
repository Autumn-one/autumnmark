<template>
  <iframe
    ref="frame"
    src="./theme-preview.html"
    sandbox="allow-scripts allow-same-origin"
    :title="title"
    @load="sendPreview"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { LocalTheme } from '@shared/localTheme'

const props = defineProps<{
  title: string
  theme: LocalTheme | string
  markdown: string
  filename: string
  sidebar: string
  source: boolean
  demo?: boolean
}>()
const emit = defineEmits<{ dismiss: [] }>()
const frame = ref<HTMLIFrameElement>()

function sendPreview(): void {
  frame.value?.contentWindow?.postMessage({
    type: 'theme-preview',
    theme: toRaw(props.theme),
    markdown: props.markdown,
    sidebar: props.sidebar,
    filename: props.filename,
    demo: props.demo ?? true,
    source: props.source
  }, '*')
}

function onMessage(event: MessageEvent): void {
  if (event.source !== frame.value?.contentWindow) return
  if (event.data?.type === 'theme-preview-ready') sendPreview()
  if (event.data?.type === 'theme-preview-dismiss') emit('dismiss')
}

watch(() => [props.theme, props.markdown, props.filename, props.sidebar, props.source, props.demo], sendPreview)
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<style scoped>
iframe { display: block; width: 100%; height: clamp(260px, 55vh, 490px); border: 0; }
</style>
