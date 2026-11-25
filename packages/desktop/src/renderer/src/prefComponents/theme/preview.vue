<template>
  <div
    class="theme-preview"
    aria-hidden="true"
  >
    <iframe
      v-if="!hasImage"
      :srcdoc="thumbnail"
      sandbox="allow-same-origin"
      loading="lazy"
      tabindex="-1"
    />
    <img
      v-if="image"
      :src="image"
      :class="{ 'is-loaded': hasImage }"
      loading="lazy"
      referrerpolicy="no-referrer"
      alt=""
      @load="loadedImage = image"
      @error="loadedImage = undefined"
    >
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { escapeHTML } from '@muyajs/core'
import type { LocalTheme } from '@shared/localTheme'
import { themeThumbnailDocument } from './previews'

const props = defineProps<{ name: string; local?: LocalTheme; image?: string }>()
const { t } = useI18n()
const loadedImage = ref<string>()
const hasImage = computed(() => !!props.image && loadedImage.value === props.image)
const sampleText = (key: string): string => escapeHTML(t(`preferences.theme.sample.${key}`))
const thumbnail = computed(() => themeThumbnailDocument(props.name, props.local, `
  <main class="use-theme-font">
    <div id="editor" class="mu-editor mu-read-only">
      <div class="mu-container">
        <h1 class="mu-atx-heading"><span class="mu-content">${sampleText('title')}</span></h1>
        <blockquote class="mu-block-quote">
          <p class="mu-paragraph">${sampleText('quote')}</p>
        </blockquote>
        <figure class="mu-table">
          <table class="mu-table-inner">
            <thead>
              <tr class="mu-table-row">
                <th class="mu-table-cell">${sampleText('section')}</th>
                <th class="mu-table-cell">${sampleText('status')}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="mu-table-row">
                <td class="mu-table-cell"><a class="mu-inline-rule" href="#">${sampleText('intro')}</a></td>
                <td class="mu-table-cell">${sampleText('draft')}</td>
              </tr>
            </tbody>
          </table>
        </figure>
        <p class="mu-paragraph"><code class="mu-inline-rule">${sampleText('code')}</code></p>
      </div>
    </div>
  </main>`))
</script>

<style scoped>
.theme-preview {
  position: relative;
  height: 144px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--editorColor10);
  border-radius: 5px;
}
.theme-preview iframe, .theme-preview img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
.theme-preview img {
  object-fit: contain;
  background: inherit;
  visibility: hidden;
}
.theme-preview img.is-loaded { visibility: visible; }
</style>
