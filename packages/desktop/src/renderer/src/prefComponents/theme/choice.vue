<template>
  <button
    type="button"
    class="theme-slot"
    :aria-label="label"
    @click="$emit('choose')"
  >
    <iframe
      class="theme-slot-swatch"
      :srcdoc="swatch"
      sandbox="allow-same-origin"
      tabindex="-1"
      aria-hidden="true"
    />
    <span class="theme-slot-info">
      <span class="theme-slot-label">
        <Sunny
          v-if="tone === 'light'"
          aria-hidden="true"
        />
        <Moon
          v-if="tone === 'dark'"
          aria-hidden="true"
        />
        {{ description }}
      </span>
      <strong>{{ name }}</strong>
    </span>
    <span
      v-if="active"
      class="theme-slot-active"
    >{{ t('preferences.theme.active') }}</span>
    <ArrowRight
      class="theme-slot-arrow"
      aria-hidden="true"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Moon, Sunny } from '@element-plus/icons-vue'
import type { LocalTheme } from '@shared/localTheme'
import { themeThumbnailDocument } from './previews'

const props = defineProps<{
  description: string
  name: string
  themeId: string
  local?: LocalTheme
  active: boolean
  tone: 'light' | 'dark' | 'all'
}>()
defineEmits<{ choose: [] }>()
const { t } = useI18n()
const swatch = computed(() => themeThumbnailDocument(props.themeId, props.local))
const label = computed(() => [props.description, props.name, props.active ? t('preferences.theme.active') : ''].filter(Boolean).join(' · '))
</script>

<style scoped>
.theme-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 56px;
  padding: 7px 9px;
  border: 1px solid var(--editorColor10);
  border-radius: 6px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  text-align: start;
  font: inherit;
  cursor: pointer;
}
.theme-slot:hover { border-color: var(--themeColor); }
.theme-slot-swatch {
  width: 32px;
  height: 32px;
  flex: none;
  border: 1px solid var(--editorColor10);
  border-radius: 5px;
  pointer-events: none;
}
.theme-slot-info { display: grid; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.theme-slot-info strong { font-size: 13px; }
.theme-slot-label,
.theme-slot-active { font-size: 11px; color: var(--editorColor80); }
.theme-slot-label { display: flex; align-items: center; gap: 4px; }
.theme-slot svg { width: 13px; height: 13px; flex: none; }
.theme-slot-active { padding: 2px 5px; border-radius: 4px; background: var(--themeColor10); }
</style>
