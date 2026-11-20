import { shallowRef } from 'vue'
import { t } from '@/i18n'

export interface BatchMediaTarget {
  pathname: string
  isDirectory: boolean
}

export const batchMediaTarget = shallowRef<BatchMediaTarget | null>(null)

export function batchMediaMenuItem(target: { pathname: string; isDirectory?: boolean }) {
  return {
    id: 'embedBatchMedia',
    label: t('batchMedia.title'),
    click: () => {
      if (batchMediaTarget.value) return
      batchMediaTarget.value = { pathname: target.pathname, isDirectory: !!target.isDirectory }
    }
  }
}
