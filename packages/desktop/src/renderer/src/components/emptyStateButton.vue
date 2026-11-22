<template>
  <el-button
    text
    bg
    type="primary"
    class="empty-state-button"
  >
    {{ label }}
  </el-button>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<style scoped>
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
