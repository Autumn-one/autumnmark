<template>
  <div class="about-dialog">
    <el-dialog
      v-model="showAboutDialog"
      :modal="true"
      custom-class="ag-dialog-table"
      width="min(460px, calc(100vw - 32px))"
      :title="name"
    >
      <template #header>
        <img
          class="logo"
          :src="AppLogo"
          alt=""
        >
      </template>
      <el-row>
        <el-col :span="24">
          <h3 class="title">
            {{ name }}
          </h3>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ store.appVersion }}
          </div>
        </el-col>
        <el-col :span="24">
          <div
            class="text"
            style="min-height: auto"
          >
            {{ copyright }}
          </div>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ copyrightContributors }}
          </div>
        </el-col>
      </el-row>
      <remote-content
        class="about-remote-content"
        kind="about"
        :active="showAboutDialog"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/store'
import bus from '../../bus'
import AppLogo from '../../assets/images/logo.png'
import { useI18n } from 'vue-i18n'
import { APP_NAME } from '@shared/brand'
import RemoteContent from '@/components/remoteContent/index.vue'

const { t } = useI18n()

const name = `${APP_NAME} · 秋笺`
const copyright = t('about.copyright', { year: new Date().getFullYear() })
const copyrightContributors = t('about.copyrightContributors')
const showAboutDialog = ref(false)

const store = useMainStore()

const showDialog = () => {
  showAboutDialog.value = true
  bus.emit('editor-blur')
}

onMounted(() => {
  bus.on('aboutDialog', showDialog)
})

onBeforeUnmount(() => {
  bus.off('aboutDialog', showDialog)
})
</script>

<style>
.about-dialog el-row,
.about-dialog el-col {
  display: block;
}

.about-dialog img.logo {
  width: 80px;
  height: 80px;
  display: inherit;
  margin: 0 auto;
}

.about-dialog .title,
.about-dialog .text {
  min-height: 32px;
  text-align: center;
}

.about-dialog .title {
  color: var(--floatFontColor);
}

.about-dialog .text {
  color: var(--floatFontColor);
}

.about-remote-content {
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 16px;
}
</style>
