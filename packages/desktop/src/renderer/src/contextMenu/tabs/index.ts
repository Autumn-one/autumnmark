import {
  SEPARATOR,
  getCloseThis,
  getCloseOthers,
  getCloseSaved,
  getCloseAll,
  getRENAME,
  getCopyPath
} from './menuItems'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'
import { popupContextMenu } from '../popupMenu'
import { getFileLocationMenuItems } from '../fileLocation'

type MenuItemShape = {
  type?: string
  click?: (...args: unknown[]) => void
  enabled?: boolean
  [key: string]: unknown
}

const wrapClick = (item: MenuItemShape, tabId: string): MenuItemShape => {
  if (!item || item.type === 'separator') return item
  const click = item.click
  return {
    ...item,
    click: click ? () => click({ _tabId: tabId }, null) : undefined
  }
}

interface ContextMenuClickEvent {
  clientX: number
  clientY: number
}

interface TabLike {
  readOnly?: boolean
  modeChanging?: boolean
  id: string
  pathname?: string | null
}

export const showContextMenu = (event: ContextMenuClickEvent, tab: TabLike): void => {
  const closeThis = getCloseThis()
  const closeOthers = getCloseOthers()
  const closeSaved = getCloseSaved()
  const closeAll = getCloseAll()
  const enabled = !!tab.pathname

  const items = [
    {
      label: t(tab.readOnly ? 'readingMode.unlock' : 'readingMode.lock'),
      enabled: !tab.modeChanging,
      click: () => {
        void useEditorStore().SET_READ_ONLY(tab.id, !tab.readOnly)
      }
    },
    SEPARATOR,
    closeThis,
    closeOthers,
    closeSaved,
    closeAll,
    SEPARATOR,
    { ...getRENAME(), enabled },
    { ...getCopyPath(), enabled }
  ].map((item) => wrapClick(item as MenuItemShape, tab.id))

  popupContextMenu([...items, ...getFileLocationMenuItems(tab)], { x: event.clientX, y: event.clientY })
}
