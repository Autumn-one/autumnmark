<template>
  <section
    :aria-label="t(`remoteContent.${kind}`)"
    :class="{ 'remote-content--announcement': kind === 'announcement' }"
  >
    <!-- eslint-disable vue/no-v-html -- Markdown is sanitized with a feed-specific allowlist before insertion. -->
    <div
      v-if="html"
      class="remote-markdown"
      tabindex="0"
      @click="openLink"
      @auxclick="openLink"
      v-html="html"
    />
    <!-- eslint-enable vue/no-v-html -->
    <div class="remote-content-status">
      <span role="status">{{ status }}</span>
      <el-button
        text
        size="small"
        :disabled="loading"
        @click="refresh(true)"
      >
        {{ t(failed ? 'remoteContent.retry' : 'remoteContent.refresh') }}
      </el-button>
    </div>
    <div
      v-if="$slots.default"
      class="remote-content-footer"
    >
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, watch, watchPostEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { renderToStaticHTML } from '@muyajs/core'
import type { RemoteContentKind } from '@shared/types/ipc'
import { useRemoteContentStore } from '@/store/remoteContent'
import { sanitize } from '@/util/dompurify'

const props = defineProps<{ active: boolean; kind: RemoteContentKind }>()
const emit = defineEmits<{ displayed: [revision: string] }>()
const { t } = useI18n()
const feed = useRemoteContentStore()
const snapshot = computed(() => feed.snapshots[props.kind])
const content = computed(() => snapshot.value?.content)
const loading = computed(() => feed.loading[props.kind])
const failed = computed(() => snapshot.value?.status === 'failed')
const webUrl = /^https?:\/\//i

const html = computed(() => {
  if (!content.value) return ''

  const rendered = renderToStaticHTML(content.value.markdown, { texMathDollars: false, sanitize: false })
  return sanitize(rendered, {
    ALLOWED_TAGS: [
      'a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del',
      'blockquote', 'ul', 'ol', 'li', 'code', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt'],
    ALLOWED_URI_REGEXP: webUrl,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  })
})

const status = computed(() => {
  if (loading.value) return t('remoteContent.loading')
  if (failed.value) return t(content.value ? 'remoteContent.refreshFailed' : 'remoteContent.loadFailed')
  if (snapshot.value?.status === 'unverified') return t('remoteContent.unverified')
  return ''
})

const refresh = (force: boolean): Promise<void> => feed.refresh(props.kind, force)

const openLink = (event: MouseEvent): void => {
  if (event.type === 'auxclick' && event.button !== 1) return
  if (!(event.target instanceof Element)) return
  const href = event.target.closest('a')?.getAttribute('href')
  if (href && webUrl.test(href)) {
    event.preventDefault()
    void window.electron.shell.openExternal(href)
  }
}

let previouslyOpened = false
watch(() => props.active, (active) => {
  if (active) {
    void refresh(previouslyOpened)
    previouslyOpened = true
  }
}, { immediate: true })

watchPostEffect(() => {
  const revision = snapshot.value?.announcementRevision
  if (props.active && revision && html.value) emit('displayed', revision)
})
</script>

<style scoped>
.remote-markdown {
  max-height: min(48vh, 440px);
  overflow: auto;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.remote-markdown :deep(:first-child) {
  margin-top: 0;
}

.remote-markdown :deep(:last-child) {
  margin-bottom: 0;
}

.remote-markdown :deep(a) {
  color: var(--themeColor);
  text-decoration: underline;
}

.remote-markdown :deep(img) {
  max-width: 100%;
}

.remote-markdown :deep(pre) {
  overflow: auto;
}

.remote-content-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.remote-content--announcement {
  max-height: calc(100dvh - 120px);
  overflow-y: auto;
  padding: 2px;
}

.remote-content--announcement,
.remote-content--announcement .remote-markdown {
  scrollbar-width: thin;
  scrollbar-color: var(--editorColor30) transparent;
}

.remote-content--announcement .remote-markdown {
  max-height: none;
  overflow: visible;
  border: 1px solid var(--editorColor10);
  border-radius: 10px;
  padding: clamp(14px, 4vw, 24px);
  background: var(--editorColor04);
  color: var(--editorColor80);
  font-size: 14px;
  line-height: 1.75;
}

.remote-content--announcement .remote-markdown :deep(:is(h1, h2, h3, h4, h5, h6)) {
  margin: 1.1em 0 0.5em;
  font-weight: 650;
  line-height: 1.4;
}

.remote-content--announcement .remote-markdown :deep(h1) {
  font-size: 1.55em;
}

.remote-content--announcement .remote-markdown :deep(h2) {
  font-size: 1.25em;
}

.remote-content--announcement .remote-markdown :deep(:is(h3, h4, h5, h6)) {
  font-size: 1.08em;
}

.remote-content--announcement .remote-markdown :deep(:is(p, ul, ol, pre, table, blockquote)) {
  margin: 0.75em 0;
}

.remote-content--announcement .remote-markdown :deep(:is(ul, ol)) {
  padding-inline-start: 1.5em;
}

.remote-content--announcement .remote-markdown :deep(li + li) {
  margin-top: 0.35em;
}

.remote-content--announcement .remote-markdown :deep(blockquote) {
  border-inline-start: 3px solid #ca7848;
  padding: 2px 12px;
  background: var(--floatBgColor);
}

.remote-content--announcement .remote-markdown :deep(:is(pre, td, th)) {
  border: 1px solid var(--editorColor10);
  padding: 6px 10px;
}

.remote-content--announcement .remote-markdown :deep(:is(pre, th)) {
  background: var(--floatBgColor);
}

.remote-content--announcement .remote-markdown :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.remote-content--announcement .remote-markdown :deep(> :first-child) {
  margin-top: 0;
}

.remote-content--announcement .remote-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.remote-content--announcement .remote-content-status {
  margin: 6px 0 12px;
  color: var(--floatFontColor);
  font-size: 12px;
}

.remote-content--announcement .remote-content-status :deep(.el-button) {
  flex-shrink: 0;
}

@media (min-width: 480px) and (min-height: 680px) {
  .remote-content--announcement {
    display: flex;
    flex-direction: column;
  }

  .remote-content--announcement .remote-markdown {
    min-height: 120px;
    overflow: auto;
  }

  .remote-content--announcement :is(.remote-content-status, .remote-content-footer) {
    flex: none;
  }
}
</style>
