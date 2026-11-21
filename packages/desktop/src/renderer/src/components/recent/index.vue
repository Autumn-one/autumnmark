<template>
  <section class="recent-files-projects" :aria-label="t('recent.noTabsOpen')">
    <img :src="AppLogo" alt="" width="48" height="48" draggable="false" />
    <h1><span lang="zh-CN">秋笺</span> {{ APP_NAME }}</h1>
    <button type="button" class="new-file" @click="newFile">
      {{ t('recent.newFile') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import AppLogo from '@/assets/images/logo.png'
import { useEditorStore } from '@/store/editor'
import { APP_NAME } from '@shared/brand'
import { t } from '../../i18n'

const editorStore = useEditorStore()

const newFile = () => {
  editorStore.NEW_UNTITLED_TAB({})
}
</script>

<style scoped>
.recent-files-projects {
  background: var(--editorBgColor);
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
  color: var(--editorColor);
}

h1 {
  margin: 0;
  font-size: 19px;
  line-height: 1.5;
  font-weight: 600;
}

.new-file {
  margin-top: 5px;
  padding: 6px 17px;
  border: 0;
  border-radius: 5px;
  background: #6547b8;
  color: #fff;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
}

.new-file:hover {
  background: #573ca2;
}

.new-file:focus-visible {
  outline: 2px solid var(--editorColor);
  outline-offset: 3px;
}
</style>
