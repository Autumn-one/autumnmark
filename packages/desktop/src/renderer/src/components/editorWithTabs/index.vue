<template>
  <div
    class="editor-with-tabs"
    :style="{ '--editor-min-width': `${MIN_EDITOR_WIDTH}px` }"
  >
    <tabs v-show="showTabBar" />
    <div class="container">
      <div class="document-body">
        <editor
          :markdown="markdown"
          :cursor="cursor"
          :text-direction="textDirection"
          :platform="platform"
          @heading-link="headingLink = $event"
          @edit-embedded-image="embeddedImage = $event"
        />
        <source-code
          v-if="sourceCode"
          :markdown="markdown"
          :muya-index-cursor="muyaIndexCursor"
          :text-direction="textDirection"
          @heading-link="headingLink = $event"
          @edit-embedded-image="embeddedImage = $event"
        />
      </div>
    </div>
    <tab-notifications />
    <heading-link-picker v-if="headingLink" :request="headingLink" @close="headingLink = null" />
    <embedded-image-dialog
      v-if="embeddedImage"
      :image="embeddedImage"
      @close="embeddedImage = null"
    />
  </div>
</template>

<script setup lang="ts">
import { MIN_EDITOR_WIDTH } from '@/util/editorLayout'
import Tabs from './tabs.vue'
import { shallowRef, watch } from 'vue'
import type { IEmbeddedImageEdit } from '@muyajs/core'
import { useEditorStore } from '@/store/editor'
import EmbeddedImageDialog from './embeddedImageDialog.vue'
import HeadingLinkPicker from './headingLinkPicker.vue'
import type { HeadingLinkRequest } from '@/util/headingLinks'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'

const props = defineProps<{
  markdown: string
  // Tab cursor payloads cross the store boundary as unknown.
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const embeddedImage = shallowRef<IEmbeddedImageEdit | null>(null)
const headingLink = shallowRef<HeadingLinkRequest | null>(null)
const store = useEditorStore()
watch([() => props.sourceCode, () => store.currentFile?.id, () => store.currentFile?.readOnly], () => {
  embeddedImage.value = null
  headingLink.value = null
})

</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    display: flex;
    position: relative;
    min-height: 0;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
  }
}
.document-body {
  flex: 1;
  min-width: var(--editor-min-width);
  container-type: inline-size;
  height: 100%;
  overflow: hidden;
}
</style>

<style>
.mu-embedded-image,
.embedded-image-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--editorColor10);
  border-radius: 4px;
  padding: 0.1em 0.45em;
  background: var(--floatHoverColor);
  color: var(--editorColor);
  font: 0.85em var(--codeFontFamily, monospace);
  vertical-align: middle;
  cursor: pointer;
}
.mu-embedded-image {
  flex-direction: column;
  max-width: 100%;
}
.mu-embedded-image img {
  max-width: 100%;
  max-height: 55vh;
  object-fit: contain;
}
</style>
