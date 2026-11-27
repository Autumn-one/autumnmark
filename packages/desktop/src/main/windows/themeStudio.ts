import { BrowserWindow, type Extension, type Session } from 'electron'
import log from 'electron-log'
import path from 'node:path'
import { once } from 'node:events'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import { resolveThemeBackground } from '../app/nativeTheme'
import { preferencesWinOptions } from '../config'
import { t } from '../i18n'
import type Accessor from '../app/accessor'

const inspectorExtensions = new WeakMap<Session, Promise<Extension>>()

export function loadThemeInspector(session: Session): Promise<Extension> {
  const cached = inspectorExtensions.get(session)
  if (cached) return cached
  const extension = session.extensions.loadExtension(path.join(__static, 'theme-inspector'), { allowFileAccess: true })
    .catch(error => {
      inspectorExtensions.delete(session)
      throw error
    })
  inspectorExtensions.set(session, extension)
  return extension
}

export default class ThemeStudioWindow extends BaseWindow {
  constructor(accessor: Accessor, readonly themeId: string, readonly editing: boolean) {
    super(accessor)
    this.type = WindowType.STUDIO
  }

  async open(): Promise<void> {
    const { env, preferences, menu, windowManager } = this._accessor
    const prefs = preferences.getAll()
    const win = new BrowserWindow({
      webPreferences: preferencesWinOptions.webPreferences,
      width: 1160, height: 780, minWidth: 640, minHeight: 460, show: false,
      autoHideMenuBar: true, title: t('studio.title'),
      backgroundColor: resolveThemeBackground(prefs.theme, prefs.localThemes)
    })
    this.browserWindow = win
    const windowId = win.id
    this.id = windowId
    this.lifecycle = WindowLifecycle.LOADING
    menu.addSettingMenu(win)
    windowManager.add(this)
    win.on('focus', () => this.emit('window-focus'))
    const { webContents } = win
    const notifyInspector = (): void => {
      if (!webContents.isDestroyed()) webContents.send('mt::theme::inspector-changed', webContents.isDevToolsOpened())
    }
    webContents.on('devtools-opened', notifyInspector)
    webContents.on('devtools-closed', notifyInspector)
    win.once('closed', () => {
      menu.removeWindowMenu(windowId)
      this.emit('window-closed')
      this.browserWindow = null
      this.id = null
    })
    const url = this._buildUrlWithSettings(win.id, env, prefs)
    url.searchParams.set('initial', this.themeId)
    url.searchParams.set('editing', String(this.editing))
    void loadThemeInspector(webContents.session).catch(error => log.warn('Theme inspector extension unavailable', error))
    const loading = new AbortController()
    const abort = (): void => loading.abort()
    webContents.once('destroyed', abort)
    webContents.once('render-process-gone', abort)
    try {
      // A successful HTML navigation can still leave an empty page if a renderer module fails to load.
      const signal = AbortSignal.any([loading.signal, AbortSignal.timeout(45000)])
      await Promise.all([once(webContents.ipc, 'mt::theme::ready', { signal }), win.loadURL(url.href)])
      this.lifecycle = WindowLifecycle.READY
      this.bringToFront()
    } catch (error) {
      if (win.isDestroyed()) return
      win.destroy()
      throw error
    } finally {
      loading.abort()
      webContents.removeListener('destroyed', abort)
      webContents.removeListener('render-process-gone', abort)
    }
  }
}
