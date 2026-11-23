<template>
  <dialog
    ref="dialog"
    class="screenshot-viewer"
    :aria-label="t('studio.screenshot', { n: number })"
    @close="closed"
  >
    <div class="viewer-bar">
      <strong>{{ t('studio.screenshot', { n: number }) }}</strong>
      <button
        :aria-label="t('editor.mediaViewer.zoomOut')"
        @click="zoom?.zoomBy(0.8)"
      >
        −
      </button>
      <button
        :aria-label="t('editor.mediaViewer.actualSize')"
        @click="zoom?.actualSize()"
      >
        {{ percent }}%
      </button>
      <button
        :aria-label="t('editor.mediaViewer.zoomIn')"
        @click="zoom?.zoomBy(1.25)"
      >
        +
      </button>
      <button @click="dialog?.close()">
        {{ t('editor.mediaViewer.close') }}
      </button>
    </div>
    <div
      ref="stage"
      class="stage"
    >
      <img
        ref="img"
        :src="src"
        alt=""
        draggable="false"
        @load="zoom?.fit()"
      >
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ZoomPanController } from '@/util/zoomPan'

defineProps<{ src: string; number: number }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement>()
const stage = ref<HTMLDivElement>()
const img = ref<HTMLImageElement>()
const percent = ref(100)
let zoom: ZoomPanController | undefined
const closed = (): void => emit('close')
onMounted(() => {
  if (!dialog.value || !stage.value || !img.value) return
  dialog.value.showModal()
  zoom = new ZoomPanController(stage.value, img.value, {
    onChange: state => { percent.value = Math.round(state.scale * 100) },
    onBackdropClick: () => dialog.value?.close()
  })
  zoom.fit()
})
onBeforeUnmount(() => zoom?.destroy())
</script>

<style scoped>
.screenshot-viewer { inset: 0; margin: auto; padding: 0; width: 94vw; height: 92vh; border: 1px solid var(--editorColor30); border-radius: 8px; color: var(--editorColor); background: var(--editorBgColor); }
.screenshot-viewer[open] { display: flex; flex-direction: column; }
.screenshot-viewer::backdrop { background: rgb(0 0 0 / 60%); }
.viewer-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; }
.viewer-bar strong { margin-inline-end: auto; }
.stage { flex: 1; min-height: 0; overflow: hidden; display: grid; place-items: center; grid-template: minmax(0,1fr) / minmax(0,1fr); cursor: grab; background: var(--editorColor04); }
.stage img { max-width: none; user-select: none; }
</style>
