<template>
  <el-button
    text
    bg
    type="primary"
    class="empty-state-button"
    :class="{ 'brand-colors': preferences.theme === 'light' }"
  >
    <slot />
  </el-button>
</template>

<script setup lang="ts">
import { usePreferencesStore } from '@/store/preferences'

const preferences = usePreferencesStore()
</script>

<style scoped>
.brand-colors {
  --buttonPrimaryBgColor: #6547b8;
  --buttonPrimaryFontColor: #fff;
  --buttonPrimaryBgColorHover: #573ca2;
  --buttonPrimaryFontColorHover: #fff;
  --buttonPrimaryFocusShadow: var(--buttonPrimaryShadow);
}

.empty-state-button.is-text.is-has-bg {
  padding: 6px 17px;
  border: 0;
  border-radius: 5px;
  background-color: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  font-size: 14px;
  line-height: 20px;
}

.empty-state-button.is-text.is-has-bg:hover {
  background-color: var(--buttonPrimaryBgColorHover);
  color: var(--buttonPrimaryFontColorHover);
}

.empty-state-button:focus-visible {
  outline: 2px solid var(--editorColor);
  outline-offset: 3px;
}
</style>
