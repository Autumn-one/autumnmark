<template>
  <section :aria-label="t(`remoteContent.${kind}`)">
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
</style>
