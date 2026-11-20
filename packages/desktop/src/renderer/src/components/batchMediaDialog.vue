<template>
  <el-dialog
    :model-value="true"
    :title="t('batchMedia.title')"
    width="min(480px, 90vw)"
    append-to-body
    align-center
    :show-close="phase !== 'converting'"
    :close-on-click-modal="phase !== 'converting'"
    :close-on-press-escape="phase !== 'converting'"
    @close="emit('close')"
  >
    <p class="target">
      {{ target.pathname }}
    </p>
    <p role="status">
      {{ status }}
    </p>
    <div
      v-if="phase !== 'done'"
      class="media-types"
    >
      <el-checkbox
        v-model="selection.image"
        :disabled="phase !== 'ready'"
      >
        {{ t('batchMedia.images', { count: counts.image }) }}
      </el-checkbox>
      <el-checkbox
        v-model="selection.video"
        :disabled="phase !== 'ready'"
      >
        {{ t('batchMedia.videos', { count: counts.video }) }}
      </el-checkbox>
    </div>
    <details
      v-if="issues.length"
      class="issues"
    >
      <summary>{{ t('batchMedia.issues', { count: issues.length }) }}</summary>
      <ul>
        <li
          v-for="(issue, index) in issues"
          :key="index"
        >
          {{ issue }}
        </li>
      </ul>
    </details>
    <template #footer>
      <el-button
        :disabled="phase === 'converting'"
        @click="emit('close')"
      >
        {{ t(phase === 'done' ? 'dialog.close' : 'common.cancel') }}
      </el-button>
      <el-button
        v-if="phase !== 'done'"
        type="primary"
        :disabled="phase !== 'ready' || !selectedCount"
        @click="convert"
      >
        {{ t('batchMedia.convert', { count: selectedCount }) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BatchMediaTarget } from '@/contextMenu/batchMedia'
import { convertMediaDocument, scanMediaDocument, type MediaDocument, type MediaEditor } from '@/services/batchMedia'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const props = defineProps<{ target: BatchMediaTarget; edit: MediaEditor }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const phase = ref<'scanning' | 'ready' | 'converting' | 'done'>('scanning')
const selection = reactive({ image: true, video: true })
const counts = reactive({ image: 0, video: 0 })
const selectedCount = computed(() => (selection.image ? counts.image : 0) + (selection.video ? counts.video : 0))
const documents: MediaDocument[] = []
const issues = ref<string[]>([])
const processed = ref(0)
const converted = ref(0)
const total = ref(0)
let closed = false
const status = computed(() => {
  if (phase.value === 'done') return t('batchMedia.done', { count: converted.value })
  if (phase.value === 'ready') return t('batchMedia.pending', {
    count: documents.filter(doc => doc.media.some(item => selection[item.kind])).length
  })
  return t(phase.value === 'scanning' ? 'batchMedia.scanning' : 'batchMedia.converting', {
    current: processed.value, total: total.value
  })
})
function report(pathname: string, error: unknown) {
  issues.value.push(pathname + ' — ' + (error instanceof Error ? error.message : String(error)))
}

onMounted(async() => {
  const store = useEditorStore()
  store.flushActiveEditor()
  let files = [[props.target.pathname]]
  const pendingTab = store.tabs.some(tab => tab.isPendingCreation && tab.pathname === props.target.pathname)
  if (!pendingTab) {
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'mt::media::list-documents', props.target.pathname, props.target.isDirectory, [...usePreferencesStore().treePathExcludePatterns],
        store.tabs.map(tab => tab.pathname).filter(Boolean)
      )
      files = result.files
      issues.value = result.issues
    } catch (error) {
      report(props.target.pathname, error)
      files = []
    }
  }
  total.value = files.length
  for (const paths of files) {
    if (closed) return
    try {
      const doc = await scanMediaDocument(paths)
      if (doc.media.length) documents.push(doc)
      for (const item of doc.media) counts[item.kind]++
    } catch (error) {
      report(paths[0], error)
    }
    processed.value++
  }
  phase.value = 'ready'
})
onBeforeUnmount(() => { closed = true })

async function convert() {
  if (phase.value !== 'ready' || !selectedCount.value) return
  phase.value = 'converting'
  processed.value = 0
  const pending = documents.filter(doc => doc.media.some(item => selection[item.kind]))
  total.value = pending.length
  for (const doc of pending) {
    if (closed) return
    try {
      const count = await convertMediaDocument(doc, selection, props.edit, detail => report(doc.pathname, detail))
      converted.value += count
    } catch (error) {
      report(doc.pathname, error)
    }
    processed.value++
  }
  phase.value = 'done'
}
</script>

<style scoped>
.target, .issues li {
  overflow-wrap: anywhere;
}
.target {
  color: var(--el-text-color-secondary);
}
.issues {
  margin-top: 12px;
}
.issues ul {
  max-height: 24vh;
  overflow: auto;
  padding-inline-start: 20px;
}
</style>
