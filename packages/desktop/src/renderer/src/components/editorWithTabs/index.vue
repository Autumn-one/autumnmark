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
          @edit-embedded-image="handleImage"
        />
        <source-code
          v-if="sourceCode"
          :markdown="markdown"
          :muya-index-cursor="muyaIndexCursor"
          :text-direction="textDirection"
          @heading-link="headingLink = $event"
          @edit-embedded-image="handleImage"
        />
      </div>
    </div>
    <tab-notifications />
    <heading-link-picker v-if="headingLink" :request="headingLink" @close="headingLink = null" />
    <embedded-image-dialog
      v-if="embeddedImage"
      :image="embeddedImage"
      :initial-tab="initialTab"
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
import { documentVideos } from '@/util/videoAttachments'
import EmbeddedImageDialog from './embeddedImageDialog.vue'
import { dragOriginal, showImageMenu, type EmbeddedTab, reportImageError } from '@/util/embeddedImageActions'
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
const initialTab = shallowRef<EmbeddedTab>('preview')
function handleImage(image: IEmbeddedImageEdit, event?: MouseEvent) {
  if (store.currentFile) image = documentVideos(store.currentFile.id).edit(image)
  const open = (tab: EmbeddedTab) => {
    initialTab.value = tab
    embeddedImage.value = image
  }
  if (event?.type === 'dragstart') dragOriginal(image.src, image.name, image.kind)
  else if (event?.type === 'contextmenu') void showImageMenu(image, event, open).catch(error => reportImageError(error, image.kind))
  else open('preview')
}
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
.mu-embedded-video video {
  max-width: 100%;
  max-height: 36vh;
  object-fit: contain;
  cursor: default;
}
.mu-embedded-video > button {
  max-width: 100%;
  border: 0;
  padding: 0.15em 0.4em;
  background: transparent;
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
  cursor: grab;
}
.mu-embedded-video > button:is(:hover, :focus-visible) {
  text-decoration: underline;
}
.mu-embedded-image img {
  max-width: 100%;
  max-height: 55vh;
  object-fit: contain;
}
.mu-compact-mode .mu-compact-image-body .mu-embedded-image img {
  max-height: none;
}
</style>
