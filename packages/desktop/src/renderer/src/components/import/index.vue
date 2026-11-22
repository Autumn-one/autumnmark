<template>
  <div class="import-dialog">
    <el-dialog
      v-model="showImport"
      :show-close="false"
      :modal="true"
      modal-class="import-overlay"
      custom-class="ag-dialog-table"
      width="450px"
    >
      <div class="body">
        <div class="drop-container">
          <div class="img-wrapper">
            <img
              :src="importIconUrl"
              alt="import file"
            >
          </div>
          <div>{{ t('import.title') }}</div>
          <p>{{ t('import.description') }}</p>
        </div>
        <div class="file-list">
          <div>.md</div>
          <div>.html</div>
          <div>.docx</div>
          <div>.tex</div>
          <div>.wiki</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import importIconUrl from '@/assets/icons/import_file.svg?url'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showImport = defineModel<boolean>({ required: true })
</script>

<style scoped>
:global(.import-overlay) {
  /* Keep the native drag target stable when this hint appears under the pointer. */
  pointer-events: none;
}
.drop-container {
  border-radius: 5px;
  color: var(--sideBarColor);
  border: 1px dashed var(--sideBarTextColor);
  -webkit-app-region: no-drag;
  app-region: no-drag;
  & div,
  & p {
    text-align: center;
  }
}
.img-wrapper {
  width: 50px;
  height: 70px;
  margin: 40px auto 0 auto;
  & img {
    width: 100%;
    height: 100%;
  }
}
.file-list {
  margin-top: 20px;
  display: flex;
  justify-content: space-between;
  & div {
    width: 70px;
    height: 70px;
    border: 1px solid var(--sideBarTextColor);
    border-radius: 3px;
    text-align: center;
    font-size: 18px;
    line-height: 70px;
    color: var(--sideBarTitleColor);
  }
}
</style>
