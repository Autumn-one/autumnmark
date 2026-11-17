import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'

vi.hoisted(() => Object.assign(window, { path: { sep: '/' } }))
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/store/checkpoint', () => ({
  scheduleWindowCheckpoint: vi.fn(),
  requestWindowCheckpoint: vi.fn()
}))
vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: vi.fn() }))

import bus from '@/bus'
import notice from '@/services/notification'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { showContextMenu } from '@/contextMenu/tabs'
import { popupContextMenu, type ContextMenuItem } from '@/contextMenu/popupMenu'
import type { IFileState } from '@shared/types/files'

describe('open containing folder (#6073)', () => {
  const invoke = vi.fn()
  const reveal = vi.fn()
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockReset()
    pinia = createPinia()
    setActivePinia(pinia)
    Object.assign(window, {
      path: path.posix,
      electron: { ipcRenderer: { send: vi.fn(), invoke, on: vi.fn() } }
    })
    useEditorStore().tabs = [
      { id: 'current', pathname: '/notes/current.md' },
      { id: 'background', pathname: '/other/background.md' },
      { id: 'untitled', pathname: '' }
    ] as IFileState[]
    useEditorStore().currentFile = useEditorStore().tabs[0]
    useLayoutStore().SET_LAYOUT({ showSideBar: false, rightColumn: 'search' })
    bus.on('SIDEBAR::reveal-path', reveal)
  })

  afterEach(() => {
    bus.off('SIDEBAR::reveal-path', reveal)
    disposePinia(pinia)
  })

  it('opens the current document folder and reveals the path returned by main', async() => {
    invoke.mockResolvedValue('/alias/current.md')
    await useProjectStore().OPEN_CONTAINING_FOLDER()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('mt::project-open-containing-folder', 'current')
    expect(useLayoutStore().showSideBar).toBe(true)
    expect(useLayoutStore().rightColumn).toBe('files')
    expect(reveal).toHaveBeenCalledExactlyOnceWith('/alias/current.md')
  })

  it('uses the right-clicked background tab without switching documents', async() => {
    invoke.mockResolvedValue('/other/background.md')
    useProjectStore().LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
    showContextMenu({ clientX: 1, clientY: 2 }, useEditorStore().tabs[1])
    const items = vi.mocked(popupContextMenu).mock.lastCall?.[0] as ContextMenuItem[]
    const action = items.find(item => item.id === 'openContainingFolder')
    expect(action?.enabled).toBe(true)
    action?.click?.()
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith('/other/background.md'))
    expect(invoke).toHaveBeenCalledExactlyOnceWith('mt::project-open-containing-folder', 'background')
    expect(useEditorStore().currentFile?.id).toBe('current')
  })

  it('disables the menu for untitled documents and ignores missing tabs', async() => {
    const tab = useEditorStore().tabs[2]
    showContextMenu({ clientX: 1, clientY: 2 }, tab)
    const items = vi.mocked(popupContextMenu).mock.lastCall?.[0] as ContextMenuItem[]
    expect(items.find(item => item.id === 'openContainingFolder')?.enabled).toBe(false)
    await useProjectStore().OPEN_CONTAINING_FOLDER(tab.id)
    await useProjectStore().OPEN_CONTAINING_FOLDER('closed')
    useEditorStore().currentFile = tab
    await useProjectStore().OPEN_CONTAINING_FOLDER()
    expect(invoke).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reports a failed folder open without revealing a different file', async() => {
    invoke.mockRejectedValue(new Error('Folder unavailable'))
    await useProjectStore().OPEN_CONTAINING_FOLDER()
    expect(notice.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Folder unavailable' }))
    expect(reveal).not.toHaveBeenCalled()
    expect(useLayoutStore().showSideBar).toBe(false)
  })

  it('ignores documents that were closed before main processed the request', async() => {
    invoke.mockResolvedValue(null)
    await useProjectStore().OPEN_CONTAINING_FOLDER()
    expect(reveal).not.toHaveBeenCalled()
  })

  it('does not reveal a stale request after the user switches tabs', async() => {
    let complete!: (pathname: string) => void
    invoke.mockReturnValue(new Promise<string>(resolve => { complete = resolve }))
    const pending = useProjectStore().OPEN_CONTAINING_FOLDER()
    useEditorStore().currentFile = useEditorStore().tabs[1]
    complete('/notes/current.md')
    await pending
    expect(reveal).not.toHaveBeenCalled()
  })

  it('only reveals the latest requested folder', async() => {
    let complete!: (pathname: string) => void
    invoke.mockReturnValueOnce(new Promise<string>(resolve => { complete = resolve }))
    invoke.mockResolvedValueOnce('/other/background.md')
    const pending = useProjectStore().OPEN_CONTAINING_FOLDER()
    await useProjectStore().OPEN_CONTAINING_FOLDER('background')
    complete('/notes/current.md')
    await pending
    expect(reveal).toHaveBeenCalledExactlyOnceWith('/other/background.md')
  })
})
