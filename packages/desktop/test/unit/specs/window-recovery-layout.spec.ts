import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
vi.hoisted(() => {
  Object.assign(window, {
    electron: { ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn(async() => {}) } },
    path: {
      sep: '/',
      dirname: (p: string) => p,
      normalize: (p: string) => p,
      basename: (p: string) => p.split('/').pop()
    }
  })
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/store/checkpoint', () => ({ scheduleWindowCheckpoint: vi.fn() }))
import { useLayoutStore } from '@/store/layout'
import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { createDefaultLayout } from '../../../src/shared/applicationState/defaults'
import { captureWindowGeometry, fitWindowGeometry } from '../../../src/main/applicationState/windowGeometry'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})
describe('window-owned layout', () => {
  it('restores every layout field, keeps two instances independent and avoids global preference writes', async() => {
    const first = useLayoutStore()
    const preferred = createDefaultLayout()
    preferred.sidebar = {
      visible: true,
      activeView: 'search',
      preferredWidthPx: 410,
      openedFiles: { expanded: false, preferredHeightPx: 260 }
    }
    preferred.tabBar = { visible: true, mode: 'visible' }
    preferred.modes = { sourceCode: true, focus: true, typewriter: true }
    const changed = vi.fn()
    first.INITIALIZE_WINDOW_LAYOUT(preferred, changed)
    expect(first.CAPTURE_WINDOW_LAYOUT()).toEqual(preferred)
    const second = useLayoutStore(createPinia())
    second.INITIALIZE_WINDOW_LAYOUT(createDefaultLayout())
    first.TOGGLE_LAYOUT_ENTRY('showToc')
    first.SET_SIDE_BAR_WIDTH(460)
    await nextTick()
    expect(second.CAPTURE_WINDOW_LAYOUT()).toEqual(createDefaultLayout())
    expect(first.CAPTURE_WINDOW_LAYOUT()).toMatchObject({
      sidebar: { preferredWidthPx: 460, activeView: 'outline' }
    })
    expect(changed).toHaveBeenCalled()
    expect(window.electron.ipcRenderer.send).not.toHaveBeenCalledWith(
      'mt::set-user-preference',
      expect.anything()
    )
    expect(localStorage.getItem('side-bar-width')).toBeNull()
  })
  it('opens a hidden sidebar to show the outline and toggles back to files', async() => {
    const store = useLayoutStore()
    store.INITIALIZE_WINDOW_LAYOUT(createDefaultLayout())
    store.TOGGLE_LAYOUT_ENTRY('showToc')
    await nextTick()
    expect(store.showToc).toBe(true)
    expect(window.electron.ipcRenderer.send).toHaveBeenLastCalledWith(
      'mt::view-layout-changed', expect.any(Number), { showSideBar: true, showToc: true, showTabBar: false }
    )
    store.TOGGLE_LAYOUT_ENTRY('showSideBar')
    await nextTick()
    expect(store.rightColumn).toBe('outline')
    expect(window.electron.ipcRenderer.send).toHaveBeenLastCalledWith(
      'mt::view-layout-changed', expect.any(Number), { showSideBar: false, showToc: false, showTabBar: false }
    )
    store.TOGGLE_LAYOUT_ENTRY('showToc')
    store.TOGGLE_LAYOUT_ENTRY('showToc')
    expect(store.showSideBar).toBe(true)
    expect(store.rightColumn).toBe('files')
  })
  it('does not let temporary reading mode reset the preferred source mode', async() => {
    const layout = useLayoutStore()
    layout.INITIALIZE_WINDOW_LAYOUT({
      ...createDefaultLayout(),
      modes: { sourceCode: true, focus: true, typewriter: true }
    })
    const editor = useEditorStore()
    const tab = { id: 'a', readOnly: true, isSaved: true, markdown: 'Text' }
    editor.tabs = [tab] as typeof editor.tabs
    editor.currentFile = editor.tabs[0]
    await editor.SET_READ_ONLY('a', false)
    expect(layout.CAPTURE_WINDOW_LAYOUT().modes).toEqual({
      sourceCode: true,
      focus: true,
      typewriter: true
    })
  })
  it('does not expand a hidden sidebar when a folder loads', () => {
    const layout = useLayoutStore()
    layout.INITIALIZE_WINDOW_LAYOUT(createDefaultLayout())
    useProjectStore().APPLY_ROOTS({ revision: 1, roots: [{ key: '/notes', pathname: '/notes', watchToken: 'root', status: 'loading' }], reason: 'restore' })
    expect(layout.showSideBar).toBe(false)
  })
  it('clips the visible sidebar without changing or persisting the preferred width', () => {
    const layout = useLayoutStore()
    const state = createDefaultLayout()
    state.sidebar.visible = true
    state.sidebar.preferredWidthPx = 900
    const changed = vi.fn()
    layout.INITIALIZE_WINDOW_LAYOUT(state, changed)
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true })
    window.dispatchEvent(new Event('resize'))
    expect(layout.effectiveSideBarWidth).toBe(280)
    expect(layout.CAPTURE_WINDOW_LAYOUT().sidebar.preferredWidthPx).toBe(900)
    expect(changed).not.toHaveBeenCalled()
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    window.dispatchEvent(new Event('resize'))
  })
  it('drives auto visibility without persisting transient state and follows symmetric toggle exits', async() => {
    const layout = useLayoutStore()
    const changed = vi.fn()
    layout.INITIALIZE_WINDOW_LAYOUT(createDefaultLayout(), changed)
    expect(changed).not.toHaveBeenCalled()
    expect(layout.tabBarMode).toBe('auto')
    expect(layout.showTabBar).toBe(false)

    // Auto reveal and auto hide follow document count without writing a manual lock.
    layout.SET_AUTO_TAB_BAR_VISIBLE(true)
    await nextTick()
    expect(layout.showTabBar).toBe(true)
    expect(layout.tabBarMode).toBe('auto')
    expect(layout.CAPTURE_WINDOW_LAYOUT().tabBar).toEqual({ visible: false })
    expect(changed).not.toHaveBeenCalled()
    expect(window.electron.ipcRenderer.send).toHaveBeenLastCalledWith(
      'mt::view-layout-changed', expect.any(Number), { showSideBar: false, showToc: false, showTabBar: true }
    )

    layout.SET_AUTO_TAB_BAR_VISIBLE(false)
    await nextTick()
    expect(layout.showTabBar).toBe(false)
    expect(changed).not.toHaveBeenCalled()

    // Single-file manual show locks visible; single-file manual hide returns to auto.
    layout.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(layout.tabBarMode).toBe('visible')
    expect(layout.showTabBar).toBe(true)
    expect(layout.CAPTURE_WINDOW_LAYOUT().tabBar).toEqual({ visible: true, mode: 'visible' })
    expect(changed).toHaveBeenCalledTimes(1)

    layout.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(layout.tabBarMode).toBe('auto')
    expect(layout.showTabBar).toBe(false)
    expect(layout.CAPTURE_WINDOW_LAYOUT().tabBar).toEqual({ visible: false })

    // Multi-file manual hide locks hidden; multi-file manual show returns to auto.
    layout.SET_AUTO_TAB_BAR_VISIBLE(true)
    layout.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(layout.tabBarMode).toBe('hidden')
    expect(layout.showTabBar).toBe(false)
    expect(layout.CAPTURE_WINDOW_LAYOUT().tabBar).toEqual({ visible: false, mode: 'hidden' })

    const restored = useLayoutStore(createPinia())
    const restoredChanged = vi.fn()
    restored.INITIALIZE_WINDOW_LAYOUT(layout.CAPTURE_WINDOW_LAYOUT(), restoredChanged)
    restored.SET_AUTO_TAB_BAR_VISIBLE(true)
    expect(restored.showTabBar).toBe(false)
    expect(restoredChanged).not.toHaveBeenCalled()

    restored.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(restored.tabBarMode).toBe('auto')
    expect(restored.showTabBar).toBe(true)
    expect(restored.CAPTURE_WINDOW_LAYOUT().tabBar).toEqual({ visible: false })

    // Cross-scene second toggle enters the opposite manual override to flip visibility immediately.
    restored.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(restored.tabBarMode).toBe('hidden')
    restored.SET_AUTO_TAB_BAR_VISIBLE(false)
    restored.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(restored.tabBarMode).toBe('visible')
    expect(restored.showTabBar).toBe(true)
    restored.SET_AUTO_TAB_BAR_VISIBLE(true)
    restored.TOGGLE_LAYOUT_ENTRY('showTabBar')
    expect(restored.tabBarMode).toBe('hidden')
    expect(restored.showTabBar).toBe(false)

    // SET_LAYOUT stays deterministic for booleans while letting tabBarMode take precedence.
    restored.SET_LAYOUT({ showTabBar: true })
    expect(restored.tabBarMode).toBe('visible')
    restored.SET_LAYOUT({ showTabBar: false, tabBarMode: 'auto' })
    expect(restored.tabBarMode).toBe('auto')
    expect(restored.showTabBar).toBe(true)
    restored.SET_LAYOUT({ showTabBar: false })
    expect(restored.tabBarMode).toBe('hidden')
    expect(restored.showTabBar).toBe(false)

    // Legacy payloads resolve cleanly even when bypassing the disk codec.
    const legacyVisible = useLayoutStore(createPinia())
    legacyVisible.INITIALIZE_WINDOW_LAYOUT({ ...createDefaultLayout(), tabBar: { visible: true } })
    expect(legacyVisible.tabBarMode).toBe('auto')
    const legacyHidden = useLayoutStore(createPinia())
    legacyHidden.INITIALIZE_WINDOW_LAYOUT({
      ...createDefaultLayout(),
      tabBar: { visible: false, hiddenByUser: true } as typeof createDefaultLayout extends () => infer L
        ? L extends { tabBar: infer T } ? T : never
        : never
    })
    expect(legacyHidden.tabBarMode).toBe('hidden')
  })
})
describe('window geometry in external device-independent bounds', () => {
  const displays = [{ id: 'primary', workArea: { x: 0, y: 25, width: 1440, height: 875 } }]
  it('keeps the latest observed normal frame when the native maximized frame is stale', () => {
    const previous = {
      normalBounds: { x: 40, y: 60, width: 875, height: 700 },
      maximized: false,
      displayId: 'primary'
    }
    const native = {
      getNormalBounds: () => ({ x: 0, y: 25, width: 1200, height: 800 }),
      isMaximized: () => true,
      setBounds: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn()
    }
    expect(captureWindowGeometry(native, displays, 'primary', previous)).toEqual({
      ...previous, maximized: true
    })
    native.isMaximized = () => false
    expect(captureWindowGeometry(native, displays, 'primary', previous).normalBounds.width).toBe(1200)
  })
  it('brings a removed-monitor window back into the current work area', () => {
    const result = fitWindowGeometry(
      {
        normalBounds: { x: 4000, y: -2000, width: 1800, height: 1200 },
        maximized: true,
        displayId: 'removed'
      },
      displays,
      'primary'
    )
    expect(result).toEqual({
      normalBounds: { x: 0, y: 25, width: 1440, height: 875 },
      maximized: true,
      displayId: 'primary'
    })
  })
  it('retains visible negative coordinates on an existing monitor', () => {
    const left = { id: 'left', workArea: { x: -1600, y: 0, width: 1600, height: 1000 } }
    const geometry = {
      normalBounds: { x: -1500, y: 50, width: 1000, height: 800 },
      maximized: false,
      displayId: 'left'
    }
    expect(fitWindowGeometry(geometry, [left, ...displays], 'primary')).toEqual(geometry)
  })
})
