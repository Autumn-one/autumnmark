<template>
  <el-dialog
    :model-value="true"
    :title="t('embeddedImage.title')"
    width="420px"
    append-to-body
    @close="emit('close')"
  >
    <img
      class="embedded-image-preview"
      :src="image.src"
      :alt="t('embeddedImage.title')"
    >
    <p
      v-if="error"
      role="alert"
    >
      {{ t('embeddedImage.invalid') }}
    </p>
    <input
      ref="picker"
      type="file"
      accept="image/*"
      hidden
      @change="replaceFile"
    >
    <template #footer>
      <el-button
        type="danger"
        plain
        @click="apply(null)"
      >
        {{ t('embeddedImage.delete') }}
      </el-button>
      <el-button @click="replaceClipboard">
        {{ t('embeddedImage.paste') }}
      </el-button>
      <el-button
        type="primary"
        @click="picker?.click()"
      >
        {{ t('embeddedImage.choose') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IEmbeddedImageEdit } from '@muyajs/core'
import { embedImage, isEmbeddedImageUrl } from '@/util/embedImage'

const props = defineProps<{ image: IEmbeddedImageEdit }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const picker = ref<HTMLInputElement | null>(null)
const error = ref(false)
let active = true
onBeforeUnmount(() => { active = false })

function apply(src: string | null) {
  if (!active) return
  props.image.apply(src)
  emit('close')
}

async function replaceFile() {
  const file = picker.value?.files?.[0]
  if (!file) return
  try {
    apply(await embedImage(file))
  } catch {
    error.value = true
  }
}

async function replaceClipboard() {
  try {
    const src = (await window.electron.clipboard.readText()).trim()
    if (!isEmbeddedImageUrl(src)) {
      error.value = true
      return
    }
    const preview = new Image()
    preview.src = src
    await preview.decode()
    apply(src)
  } catch {
    error.value = true
  }
}
</script>

<style scoped>
.embedded-image-preview {
  display: block;
  max-width: 100%;
  max-height: 40vh;
  margin: auto;
  object-fit: contain;
}
</style>
