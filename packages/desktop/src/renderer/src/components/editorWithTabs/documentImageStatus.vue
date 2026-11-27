<template>
  <el-popover
    v-model:visible="open"
    placement="top-end"
    trigger="click"
    :width="282"
    :show-arrow="false"
    popper-class="document-image-popover"
  >
    <template #reference>
      <button type="button" class="image-status-button" :title="open ? undefined : hint" :aria-label="hint">
        <el-progress
          v-if="working"
          type="circle"
          :width="19"
          :stroke-width="3"
          :percentage="Math.floor(progress.completed / progress.total * 100)"
          :show-text="false"
        />
        <span v-else class="image-symbol" :class="{ empty: !embedded && !pending }" aria-hidden="true">
          <el-icon><Picture /></el-icon>
          <el-icon v-if="embedded || pending || failed" class="image-badge" :class="{ embedded: !pending && !failed }">
            <WarningFilled v-if="failed" />
            <Link v-else-if="pending" />
            <Check v-else />
          </el-icon>
        </span>
      </button>
    </template>
    <section class="image-details" @keydown.esc="open = false">
      <strong>{{ t('documentImages.title') }}</strong>
      <span class="image-counts">{{ t('documentImages.summary', { embedded, pending }) }}</span>
      <el-button v-if="pending" size="small" :disabled="!menuItem.enabled" @click="startConversion">
        {{ menuItem.label }}
      </el-button>
    </section>
  </el-popover>
  <span v-if="progress.total" class="image-paste-progress" role="status">{{ hint }}</span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Link, Picture, WarningFilled } from '@element-plus/icons-vue'
import type { ContextMenuItem } from '@/contextMenu/popupMenu'

const props = defineProps<{
  documentId?: string
  embedded: number
  pending: number
  progress: { total: number; completed: number; failed: number }
  menuItem: ContextMenuItem
}>()
const emit = defineEmits<{ convert: [] }>()
const { t } = useI18n()
const open = ref(false)
watch(() => props.documentId, () => {
  open.value = false
})
const working = computed(() => props.progress.completed < props.progress.total)
const failed = computed(() => !working.value && props.progress.failed > 0)
const hint = computed(() => {
  if (failed.value) return t('embeddedImage.pasteFailed', props.progress)
  if (working.value) return t('embeddedImage.pasteProgress', props.progress)
  if (!props.embedded && !props.pending) return t('documentImages.noImages')
  return props.pending ? t('documentImages.pending', { count: props.pending }) : t('documentImages.allEmbedded')
})

function startConversion() {
  open.value = false
  emit('convert')
}
</script>

<style scoped>
.image-status-button {
  display: grid;
  place-items: center;
  position: relative;
  width: 32px;
  height: 27px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--editorColor);
}
.image-status-button::before {
  position: absolute;
  inset-inline-start: -3px;
  width: 1px;
  height: 14px;
  background: var(--editorColor10);
  content: '';
}
.image-status-button:is(:hover, :focus-visible, [aria-expanded="true"]) { background: var(--floatHoverColor); }
.image-symbol { position: relative; display: flex; font-size: 18px; }
.image-symbol.empty { color: var(--editorColor50); }
.image-symbol .image-badge {
  position: absolute;
  right: -4px;
  bottom: -2px;
  font-size: 12px;
  color: var(--themeColor);
  border-radius: 50%;
  background: var(--floatBgColor);
}
.image-symbol .embedded { color: var(--editorColor); }
.image-details { display: grid; gap: 9px; color: var(--editorColor); }
.image-counts { font-size: 13px; color: var(--editorColor80); font-variant-numeric: tabular-nums; }
.image-paste-progress { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
