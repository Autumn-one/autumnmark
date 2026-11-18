import { defineStore } from 'pinia'
import { t } from '../i18n'
import notice from '../services/notification'

export const useAutoUpdatesStore = defineStore('autoUpdates', () => {
  function LISTEN_FOR_UPDATE(): void {
    window.electron.ipcRenderer.on('mt::UPDATE_ERROR', (_event, stage) => {
      void notice.notify({
        title: t('updates.title'),
        type: 'error',
        message: t(stage === 'install' ? 'updates.installFailed' : 'updates.checkFailed')
      })
    })
    window.electron.ipcRenderer.on('mt::UPDATE_NOT_AVAILABLE', () => {
      void notice.notify({
        title: t('updates.title'),
        type: 'primary',
        message: t('updates.upToDate')
      })
    })
    window.electron.ipcRenderer.on('mt::UPDATE_DOWNLOADED', () => {
      void notice.notify({
        title: t('updates.title'),
        type: 'info',
        message: t('updates.downloaded')
      })
    })
  }

  return { LISTEN_FOR_UPDATE }
})
