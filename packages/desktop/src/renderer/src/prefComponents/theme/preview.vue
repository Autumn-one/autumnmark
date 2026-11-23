<template>
  <div
    class="theme-preview"
    :style="style"
    aria-hidden="true"
  >
    <img
      v-if="image"
      :src="image"
      :class="{ 'is-loaded': loadedImage === image }"
      loading="lazy"
      referrerpolicy="no-referrer"
      alt=""
      @load="loadedImage = image"
      @error="loadedImage = undefined"
    >
    <div class="theme-preview-sample">
      <strong>{{ t('preferences.theme.sample.title') }}</strong>
      <blockquote>{{ t('preferences.theme.sample.quote') }}</blockquote>
      <table>
        <thead><tr><th>{{ t('preferences.theme.sample.section') }}</th><th>{{ t('preferences.theme.sample.status') }}</th></tr></thead>
        <tbody><tr><td>{{ t('preferences.theme.sample.intro') }}</td><td>{{ t('preferences.theme.sample.draft') }}</td></tr></tbody>
      </table>
      <code>**{{ t('preferences.theme.sample.code') }}**</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocalTheme } from '@shared/localTheme'
import { themePreviewStyle } from './previews'

const props = defineProps<{ name: string; local?: LocalTheme; image?: string }>()
const { t } = useI18n()
const loadedImage = ref<string>()
const style = computed(() => themePreviewStyle(props.name, props.local))
</script>

<style scoped>
.theme-preview {
  position: relative;
  display: grid;
  min-height: 124px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--preview-border);
  border-radius: 5px;
}
.theme-preview img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: inherit;
  visibility: hidden;
}
.theme-preview img.is-loaded { visibility: visible; }
.theme-preview-sample { display: grid; gap: 5px; padding: 8px; font-size: 11px; overflow-wrap: anywhere; }
.theme-preview strong { color: var(--preview-heading); font: 600 16px/1.3 Georgia, serif; }
.theme-preview blockquote {
  margin: 0;
  padding: 3px 5px;
  border-inline-start: 2px solid var(--preview-link);
  background: var(--preview-tint);
}
.theme-preview table { width: 100%; border-collapse: collapse; text-align: start; }
.theme-preview th,
.theme-preview td { border: 1px solid var(--preview-border); padding: 2px 4px; text-align: start; }
.theme-preview th { background: var(--preview-tint); }
.theme-preview code { padding: 3px 5px; color: var(--preview-link); background: var(--preview-code); border-radius: 3px; }
</style>
