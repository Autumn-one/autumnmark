<template>
  <section class="recent-files-projects" :aria-label="t('recent.noTabsOpen')">
    <img :src="AppLogo" alt="" width="48" height="48" draggable="false" />
    <h1><span lang="zh-CN">秋笺</span> {{ APP_NAME }}</h1>
    <EmptyStateButton
      class="new-file"
      :label="t('recent.newFile')"
      @click="newFile"
    />
  </section>
</template>

<script setup lang="ts">
import AppLogo from '@/assets/images/logo.png'
import EmptyStateButton from '@/components/emptyStateButton.vue'
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
}
</style>
