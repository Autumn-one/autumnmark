import bus from '@/bus'
import { t } from '@/i18n'
import { useEditorStore } from '@/store/editor'
import type { ContextMenuItem } from './popupMenu'
import { copyPath } from './tabs/actions'

interface FileLocationTab {
  id: string
  pathname?: string | null
}

export const getFileLocationMenuItems = (tab: FileLocationTab): ContextMenuItem[] => [
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

export const getDocumentLocationMenuItems = (tab: FileLocationTab): ContextMenuItem[] => [
  ...getFileLocationMenuItems(tab),
  {
    label: t('contextMenu.copyFilePath'),
    id: 'copyFilePath',
    enabled: !!tab.pathname,
    click: () => copyPath(tab.id)
  },
  {
    label: t('contextMenu.copyFolderPath'),
    id: 'copyFolderPath',
    enabled: !!tab.pathname,
    click: () => copyPath(tab.id, 'folder')
  }
]
