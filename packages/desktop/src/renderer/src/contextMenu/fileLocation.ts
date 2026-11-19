import bus from '@/bus'
import { t } from '@/i18n'
import { useEditorStore } from '@/store/editor'
import type { ContextMenuItem } from './popupMenu'

export const getFileLocationMenuItems = (tab: {
  id: string
  pathname?: string | null
}): ContextMenuItem[] => [
  {
    label: t('contextMenu.tabs.showInFolder'),
    id: 'showInFolder',
    enabled: !!tab.pathname,
    click: () => {
      const file = useEditorStore().tabs.find(file => file.id === tab.id)
      if (file?.pathname) window.electron.shell.showItemInFolder(file.pathname)
    }
  },
  {
    label: t('contextMenu.tabs.openContainingFolder'),
    id: 'openContainingFolder',
    enabled: !!tab.pathname,
    click: () => bus.emit('SIDEBAR::open-containing-folder', tab.id)
  }
]
