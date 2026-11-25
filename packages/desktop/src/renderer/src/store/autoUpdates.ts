import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { t } from '@/i18n'
import type { UpdateState } from '@shared/types/ipc'

export const useAutoUpdatesStore = defineStore('autoUpdates', () => {
  const state = ref<UpdateState>({ phase: 'idle' })
  const visible = ref(false)
  const showProgressButton = computed(() => state.value.phase === 'checking' || 'version' in state.value)
  const progress = computed(() => state.value.phase === 'downloading' ? state.value.progress : null)
  const percent = computed(() => {
    const download = progress.value
    if (!download || download.total <= 0) return null
    return Math.min(100, Math.floor(100 * download.transferred / download.total))
  })
  const status = computed(() => {
    const s = state.value
    switch (s.phase) {
      case 'checking': return t('updates.checking')
      case 'downloading': return percent.value === 100
        ? t('updates.preparing', { version: s.version })
        : t('updates.downloading', { version: s.version })
      case 'ready': return t('updates.ready', { version: s.version })
      case 'installing': return t('updates.downloaded')
      case 'current': return t('updates.upToDate')
      case 'error': return t({ check: 'updates.checkFailed', download: 'updates.downloadFailed', install: 'updates.installFailed' }[s.stage])
      default: return ''
    }
  })

  function listen(): () => void {
    const ipc = window.electron.ipcRenderer
    const off = ipc.on('mt::update-state', (_event, next, show) => {
      state.value = next
      if (show) visible.value = true
    })
    ipc.send('mt::update-listen')
    return off
  }

  function hide(): void {
    if (!visible.value) return
    visible.value = false
    window.electron.ipcRenderer.send('mt::update-background')
  }

  function retry(): void {
    window.electron.ipcRenderer.send('mt::check-for-update')
  }

  function install(): void {
    if ('version' in state.value && state.value.version) {
      window.electron.ipcRenderer.send('mt::update-install', state.value.version)
    }
  }

  return { state, progress, percent, status, showProgressButton, visible, listen, hide, retry, install }
})
