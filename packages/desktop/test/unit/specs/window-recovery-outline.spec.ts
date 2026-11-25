import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
vi.hoisted(() => {
  Object.assign(window, {
    electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } },
    path: { sep: '/', dirname: (p: string) => p }
  })
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/components/sideBar/toc.vue', () => ({ default: { template: '<div>Headings</div>' } }))
vi.mock('@/components/iconTooltip/index.vue', () => ({
  default: { template: '<span><slot /></span>' }
}))
vi.mock('@/components/sideBar/tree.vue', () => ({ default: { template: '<div>Files</div>' } }))
vi.mock('@/components/sideBar/search.vue', () => ({ default: { template: '<div>Search</div>' } }))
import SideBar from '@/components/sideBar/index.vue'
import { useLayoutStore } from '@/store/layout'
import { createDefaultLayout } from '../../../src/shared/applicationState/defaults'
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})
it('restores the outline tab and supports switching sidebar tabs with the keyboard', async() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLayoutStore()
  const layout = createDefaultLayout()
  layout.sidebar.visible = true
  layout.sidebar.activeView = 'outline'
  store.INITIALIZE_WINDOW_LAYOUT(layout)
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(SideBar)
  app
    .use(pinia)
    .use(createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false }))
  app.mount(root)
  await nextTick()
  const outline = root.querySelector<HTMLButtonElement>('#sidebar-tab-outline')
  const files = root.querySelector<HTMLButtonElement>('#sidebar-tab-files')
  if (!outline || !files) throw new Error('Missing sidebar tabs')
  expect(outline.getAttribute('aria-selected')).toBe('true')
  expect(files.tabIndex).toBe(-1)
  outline.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  await nextTick()
  expect(store.showToc).toBe(false)
  expect(files.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(files)
})
