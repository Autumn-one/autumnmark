import { useEditorStore } from '@/store/editor'

export const closeThis = (tabId: string): void => {
  const store = useEditorStore()
  const tab = store.tabs.find(file => file.id === tabId)
  if (tab) store.CLOSE_TAB(tab)
}

export const closeOthers = (tabId: string): void => {
  const store = useEditorStore()
  const tab = store.tabs.find(file => file.id === tabId)
  if (tab) store.CLOSE_OTHER_TABS(tab)
}

export const closeSaved = (): void => {
  useEditorStore().CLOSE_SAVED_TABS()
}

export const closeAll = (): void => {
  useEditorStore().CLOSE_ALL_TABS()
}

export const rename = (tabId: string): void => {
  const store = useEditorStore()
  const tab = store.tabs.find(file => file.id === tabId)
  if (tab?.pathname) store.RENAME_FILE(tab)
}

export const copyPath = (tabId: string, target: 'file' | 'folder' = 'file'): void => {
  const tab = useEditorStore().tabs.find(file => file.id === tabId)
  if (!tab?.pathname) return
  const pathname = target === 'folder' ? window.path.dirname(tab.pathname) : tab.pathname
  window.electron.clipboard.writeText(pathname)
}
