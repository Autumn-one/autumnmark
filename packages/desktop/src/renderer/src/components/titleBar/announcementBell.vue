<template>
  <button
    type="button"
    class="plain-button announcement-trigger"
    :aria-label="buttonLabel"
    :title="buttonLabel"
    aria-haspopup="dialog"
    @click="open"
  >
    <svg
      class="announcement-icon"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          :id="goldGradient"
          x1="5"
          y1="2"
          x2="19"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#fff2be" />
          <stop
            offset=".28"
            stop-color="#efb941"
          />
          <stop
            offset=".45"
            stop-color="#c98920"
          />
          <stop
            offset=".57"
            stop-color="#ffe496"
          />
          <stop
            offset=".79"
            stop-color="#edb13b"
          />
          <stop
            offset="1"
            stop-color="#a56013"
          />
        </linearGradient>
        <linearGradient
          :id="unreadGradient"
          x2=".35"
          y2="1"
        >
          <stop stop-color="#eb795c" />
          <stop
            offset="1"
            stop-color="#c34231"
          />
        </linearGradient>
      </defs>
      <g
        :fill="`url(#${goldGradient})`"
        stroke="#96580f"
        stroke-width="1"
        stroke-linejoin="round"
      >
        <circle
          cx="12"
          cy="4.4"
          r="1.7"
        />
        <circle
          cx="12"
          cy="18.7"
          r="2.4"
        />
        <path d="M12 5.3a5.7 5.7 0 0 0-5.7 5.7v2a4.4 4.4 0 0 1-1.3 3.1l-.6.6a1 1 0 0 0 .7 1.7h13.8a1 1 0 0 0 .7-1.7l-.6-.6a4.4 4.4 0 0 1-1.3-3.1v-2A5.7 5.7 0 0 0 12 5.3Z" />
      </g>
      <path
        d="M8.1 12.2V11a3.9 3.9 0 0 1 2.1-3.5M5.9 16.9h12.2"
        fill="none"
        stroke="#fff4cc"
        stroke-linecap="round"
        stroke-opacity=".8"
      />
      <circle
        v-if="unread"
        class="announcement-dot"
        cx="18"
        cy="7.4"
        r="2.8"
        :fill="`url(#${unreadGradient})`"
        stroke="#a3422d"
        stroke-width=".65"
      />
    </svg>
  </button>

  <el-dialog
    v-model="visible"
    class="announcement-dialog"
    :title="title"
    width="min(760px, calc(100vw - 32px))"
    align-center
    append-to-body
  >
    <template #header="{ titleId, titleClass }">
      <h2
        :id="titleId"
        :class="titleClass"
        class="announcement-title"
      >
        {{ title }}
      </h2>
    </template>
    <div class="announcement-layout">
      <div class="announcement-feeds">
        <remote-content
          kind="announcement"
          :active="visible"
          panel
          @displayed="displayedRevision = $event"
        />
        <remote-content
          kind="about"
          :active="visible"
          panel
        />
      </div>
      <announcement-donation />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import RemoteContent from '@/components/remoteContent/index.vue'
import AnnouncementDonation from '@/components/remoteContent/announcementDonation.vue'
import { usePreferencesStore } from '@/store/preferences'
import { useRemoteContentStore } from '@/store/remoteContent'

const { t } = useI18n()
const title = computed(() => t('remoteContent.announcement'))
const goldGradient = useId()
const unreadGradient = useId()
const visible = ref(false)
const displayedRevision = ref('')
const preferences = usePreferencesStore()
const feed = useRemoteContentStore()
const announcement = computed(() => feed.snapshots.announcement)
const unread = computed(() => {
  const lastRead = preferences.lastReadAnnouncement
  const snapshot = announcement.value
  // A stale mirror cannot establish that a previously read announcement has changed.
  return lastRead !== null && !!snapshot?.announcementRevision &&
    (snapshot.content?.verified || !lastRead) && snapshot.announcementRevision !== lastRead
})
const buttonLabel = computed(() => unread.value ? t('remoteContent.unreadAnnouncement') : title.value)
const unsubscribe = window.electron.ipcRenderer.on('mt::announcement-changed', (_event, snapshot) => {
  feed.snapshots.announcement = snapshot
})
onBeforeUnmount(unsubscribe)
void feed.refresh('announcement', false)

watchEffect(() => {
  if (visible.value && unread.value && displayedRevision.value === announcement.value?.announcementRevision) {
    preferences.SET_USER_DATA({ type: 'lastReadAnnouncement', value: displayedRevision.value })
  }
})

const open = (): void => {
  bus.emit('editor-blur')
  displayedRevision.value = ''
  visible.value = true
}
</script>

<style scoped>
:global(.el-dialog.announcement-dialog) {
  --el-dialog-padding-primary: 14px;
  border-radius: 14px;
}

:global(.announcement-dialog .el-dialog__header) {
  margin: 0;
  border-bottom: 1px solid var(--floatBorderColor);
  padding: 12px 46px 12px 16px;
}

.announcement-layout {
  display: grid;
  grid-template-columns: minmax(0, 2.5fr) minmax(160px, 1fr);
  gap: 10px;
  max-height: calc(100dvh - 124px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--editorColor30) transparent;
}

.announcement-feeds {
  display: grid;
  grid-template-rows: 1fr auto;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

@media (max-width: 550px) {
  .announcement-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.announcement-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--editorColor80);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.4;
}

.announcement-title::before {
  width: 4px;
  height: 20px;
  border-radius: 4px;
  background: #ca7848;
  content: '';
}

.announcement-trigger {
  -webkit-app-region: no-drag;
  display: grid;
  flex: none;
  width: 36px;
  height: 100%;
  place-items: center;
}

.announcement-icon {
  --bell-swing: 16deg;
  --bell-half-cycle: 600ms;
  transform-origin: 50% 18%;
  animation: ring-bell var(--bell-half-cycle) ease-in-out infinite alternate;
}

@keyframes ring-bell {
  from {
    transform: rotate(calc(-1 * var(--bell-swing)));
  }
  to {
    transform: rotate(var(--bell-swing));
  }
}

@media (prefers-reduced-motion: reduce) {
  .announcement-icon {
    --bell-swing: 7deg;
    --bell-half-cycle: 850ms;
  }
}
</style>
