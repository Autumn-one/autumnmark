import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { dialog, ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log'
import { isLocalTheme, localThemeList, maxThemeNameLength, themeBases, themeSelectionPatch, type LocalTheme, type ThemeModelEvent, type ThemeModelRequest } from '@shared/localTheme'
import type { AppliedThemeHistory, ThemeVersionChange } from '@shared/themeVersion'
import type { DocumentChatThemeEffect } from '@shared/documentChat'
import type { SkillTheme } from '@shared/autumnmarkSkill'
import type { UserPreferences } from '@shared/types/preferences'
import { reverseTextChange } from '@shared/reversibleText'
import { themeCssIssue } from '@shared/themeCss'
import type Accessor from '../app/accessor'
import { WindowLifecycle, WindowType, type WindowTypeValue } from '../windows/base'
import { t } from '../i18n'
import { onInternalChannel } from '../utils/internalIpc'
import ThemeStudioWindow, { loadThemeInspector } from '../windows/themeStudio'
import { generateTheme, summarizeThemeVersion, type ThemeSettings } from './themeModel'
import { previewCaptureTool } from './themePreviewCapture'
import { runThemeTools } from './themeTools'
import { registerThemeCollaboration } from './themeCollaboration'
import { requireModelWindow } from './aiModels'
import type { ChatSettings } from './openAi'
import { appliedThemeSnapshot, createActiveThemeVersions, type AppliedThemeChange } from './activeThemeVersions'

export interface SkillActiveTheme {
  read(): SkillTheme & { css: string; revision: string }
  edit(id: string, revision: string, css: string): { changed: boolean }
}

export const registerThemeStudio = (app: Accessor, savedSettings: (id: string) => Promise<ChatSettings>): SkillActiveTheme => {
  registerThemeCollaboration(app)
  const activeVersions = createActiveThemeVersions(app.paths.userDataPath)
  const pending = new Map<number, { id: string; controller: AbortController }>()
  let openingStudio: Promise<void> | undefined
  const authorize = (event: IpcMainInvokeEvent, type: WindowTypeValue = WindowType.STUDIO): void =>
    requireModelWindow(app, event, type)

  const openStudio = async(id: string, editing: boolean): Promise<void> => {
    const library = localThemeList(app.preferences.getAll().localThemes)
    const local = library.find(item => item.id === id)
    if (typeof editing !== 'boolean' || (!local && (editing || !themeBases.includes(id)))) throw new Error('invalidRequest')
    if (openingStudio) await openingStudio
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      if (win instanceof ThemeStudioWindow && win.lifecycle === WindowLifecycle.READY) {
        win.browserWindow?.webContents.send('mt::theme::show', id, editing)
        win.bringToFront()
        return
      }
    }
    const studio = new ThemeStudioWindow(app, id, editing)
    openingStudio = studio.open()
    try { await openingStudio }
    finally { openingStudio = undefined }
  }
  onInternalChannel('create-theme-from-current', () => {
    void openStudio(app.preferences.getAll().theme, false).catch(error => {
      log.error('Opening the theme editor failed', error)
      dialog.showErrorBox(t('studio.title'), t('studio.openFailed'))
    })
  })
  ipcMain.handle('mt::theme::open', (event, id: string, editing: boolean) => {
    authorize(event, WindowType.SETTINGS)
    return openStudio(id, editing)
  })
  ipcMain.handle('mt::theme::inspector-state', event => {
    authorize(event)
    return event.sender.isDevToolsOpened()
  })
  ipcMain.handle('mt::theme::set-inspector', async(event, open: boolean) => {
    authorize(event)
    const { sender } = event
    if (typeof open !== 'boolean') throw new Error('invalidRequest')
    const wasOpen = sender.isDevToolsOpened()
    if (open && !wasOpen) {
      await loadThemeInspector(sender.session)
      if (!sender.isDestroyed()) sender.openDevTools({ mode: 'right', activate: false })
    }
    if (!open && wasOpen) sender.closeDevTools()
  })
  ipcMain.handle('mt::theme::inspect-element', (event, x: number, y: number) => {
    authorize(event)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('invalidRequest')
    const { sender } = event
    if (sender.isDevToolsOpened()) {
      const zoom = sender.getZoomFactor()
      sender.inspectElement(Math.round(x * zoom), Math.round(y * zoom))
    }
  })
  function persistTheme(theme: LocalTheme, patch: Partial<UserPreferences>, existing?: LocalTheme, change?: AppliedThemeChange): LocalTheme | null {
    let record: (() => void) | undefined
    if (change) {
      try { record = activeVersions.stage(theme, existing, change) }
      catch (error) {
        log.warn('Could not prepare applied theme history', error)
        throw new Error('theme-history-save-failed', { cause: error })
      }
    }
    const result = app.preferences.update(patch)
    if (result.status !== 'persisted') return null
    record?.()
    return theme
  }

  const saveTheme = (input: LocalTheme, apply: boolean, copy = false, change?: AppliedThemeChange): LocalTheme | null => {
    const { version, base, values, css } = input
    let { id, name } = input
    name = name.trim()
    const prefs = app.preferences.getAll()
    const themes = localThemeList(prefs.localThemes)
    const existing = themes.find(theme => theme.id === id)
    const unchanged = existing && existing.name === name && (existing.css ?? '') === (css ?? '') &&
      Object.keys(existing.values).length === Object.keys(values).length &&
      Object.entries(values).every(([key, value]) => existing.values[key as keyof typeof values] === value)
    if (unchanged) {
      if (!apply) return existing
      return persistTheme(existing, themeSelectionPatch(prefs, id, nativeTheme.shouldUseDarkColors), existing, change)
    }
    const downloaded = !!existing?.catalog
    const needsNewId = downloaded || (!apply && [prefs.theme, prefs.lightModeTheme, prefs.darkModeTheme].includes(id))
    if (needsNewId) id = `local:${base}:${randomUUID()}`
    if (needsNewId || copy) {
      const existingNames = new Set(themes.map(theme => theme.name))
      const originalName = name
      for (let number = 2; existingNames.has(name); number++) {
        const suffix = ` (${number})`
        const stem = originalName.slice(0, maxThemeNameLength - suffix.length).replace(/\p{Surrogate}$/u, '').trimEnd()
        name = stem + suffix
      }
    }
    const theme = { version, id, name, base, values, css }
    const library = themes.filter(item => item.id !== id)
    library.push(theme)
    const patch = { localThemes: library, ...(apply ? themeSelectionPatch(prefs, id, nativeTheme.shouldUseDarkColors) : {}) }
    const previous = id === existing?.id ? existing : undefined
    return persistTheme(theme, patch, previous, change)
  }
  ipcMain.handle('mt::theme::save', (event, input: unknown, apply: unknown) => {
    authorize(event)
    if (!isLocalTheme(input) || typeof apply !== 'boolean') throw new Error('invalidRequest')
    return saveTheme(input, apply)
  })
  const selection = (prefs: UserPreferences) => ({ theme: prefs.theme, lightModeTheme: prefs.lightModeTheme, darkModeTheme: prefs.darkModeTheme })
  const notifyStudio = () => {
    const next = app.preferences.getAll()
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      win.browserWindow?.webContents.send('mt::preferences::changed', next)
    }
  }
  const applyInEditor = (event: IpcMainInvokeEvent, input: unknown, sourceId: unknown, expected: unknown, beforeCss?: string): DocumentChatThemeEffect | null => {
    authorize(event, WindowType.EDITOR)
    if (!isLocalTheme(input) || input.catalog || typeof sourceId !== 'string') throw new Error('invalidRequest')
    const prefs = app.preferences.getAll()
    const themes = localThemeList(prefs.localThemes)
    const source = themes.find(theme => theme.id === sourceId)
    if (sourceId !== prefs.theme || !isDeepStrictEqual(source ?? null, expected)) throw new Error('activeThemeChanged')
    const copy = !source || !!source.catalog
    if (copy) {
      if (input.base !== (source?.base ?? sourceId) || themes.some(theme => theme.id === input.id)) throw new Error('invalidRequest')
    } else if (input.id.split(':')[2] !== source.id.split(':')[2]) throw new Error('invalidRequest')
    const change: AppliedThemeChange | undefined = beforeCss === undefined ? undefined : { before: source, kind: 'ai' }
    const saved = saveTheme(input, true, copy, change)
    if (!saved) return null
    notifyStudio()
    return { before: themes.find(theme => theme.id === saved.id) ?? null, beforeCss: beforeCss ?? '', after: saved,
      selectionBefore: selection(prefs), selectionAfter: selection(app.preferences.getAll()) }
  }
  ipcMain.handle('mt::theme::apply-in-editor', (event, input: unknown, sourceId: unknown, expected: unknown) =>
    applyInEditor(event, input, sourceId, expected)?.after ?? null)
  ipcMain.handle('mt::document-chat::apply-theme', (event, input: unknown, sourceId: unknown, expected: unknown, beforeCss: string) => {
    if (typeof beforeCss !== 'string' || themeCssIssue(beforeCss)) throw new Error('invalidRequest')
    return applyInEditor(event, input, sourceId, expected, beforeCss)
  })
  ipcMain.handle('mt::document-chat::revert-theme', (event, effect: DocumentChatThemeEffect) => {
    authorize(event, WindowType.EDITOR)
    if (!isLocalTheme(effect?.after) || (effect.before !== null && (!isLocalTheme(effect.before) || effect.before.id !== effect.after.id)) ||
      typeof effect.beforeCss !== 'string' || themeCssIssue(effect.beforeCss)) throw new Error('invalidRequest')
    const prefs = app.preferences.getAll()
    const library = localThemeList(prefs.localThemes)
    const current = library.find(item => item.id === effect.after.id)
    if (!current) return !effect.before
    const unchanged = isDeepStrictEqual(current, effect.after)
    let restored = effect.before
    if (!unchanged) {
      const css = reverseTextChange(current.css ?? '', effect.beforeCss, effect.after.css ?? '')
      if (css === null || themeCssIssue(css)) return false
      restored = { ...current, css }
    }
    const nextLibrary = library.flatMap(item => item.id === current.id ? (restored ? [restored] : []) : [item])
    const preferences: Partial<UserPreferences> = { localThemes: nextLibrary }
    if (unchanged) {
      for (const key of ['theme', 'lightModeTheme', 'darkModeTheme'] as const) {
        const previous = effect.selectionBefore[key]
        if (prefs[key] === effect.selectionAfter[key] && (themeBases.includes(previous) || nextLibrary.some(item => item.id === previous))) {
          preferences[key] = previous
        } else if (!restored && prefs[key] === current.id) preferences[key] = current.base
      }
    }
    const result = app.preferences.update(preferences)
    if (result.status === 'persisted') notifyStudio()
    return result.status === 'persisted'
  })
  ipcMain.handle('mt::theme::delete', (event, id: string) => {
    requireModelWindow(app, event, WindowType.STUDIO, WindowType.SETTINGS)
    const prefs = app.preferences.getAll()
    const library = prefs.localThemes ?? []
    const theme = localThemeList(library).find(item => item.id === id)
    if (!theme) return prefs
    const result = app.preferences.update({
      localThemes: library.filter(item => item?.id !== id),
      ...(prefs.theme === id ? { theme: theme.base } : {}),
      ...(prefs.lightModeTheme === id ? { lightModeTheme: theme.base } : {}),
      ...(prefs.darkModeTheme === id ? { darkModeTheme: theme.base } : {})
    })
    if (result.status !== 'persisted') return null
    activeVersions.remove(theme)
    const next = app.preferences.getAll()
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      const contents = win.browserWindow?.webContents
      if (contents !== event.sender) contents?.send('mt::preferences::changed', next)
    }
    return next
  })
  const generate = async(event: IpcMainInvokeEvent, request: ThemeModelRequest, withTools: boolean) => {
    authorize(event)
    const { sender } = event
    if (!request || typeof request.id !== 'string' || pending.has(sender.id)) throw new Error('invalidRequest')
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    const senderId = sender.id
    pending.set(senderId, { id: request.id, controller })
    sender.once('destroyed', abort)
    // A renderer-initiated navigation can still be vetoed by the application's will-navigate handler.
    sender.once('did-navigate', abort)
    sender.once('render-process-gone', abort)
    const timer = withTools ? undefined : setTimeout(() => controller.abort(new Error('requestTimeout')), 120000)
    const trace = { wireBytes: 0, replyBytes: 0, assistantText: '' }
    let settings: ThemeSettings | undefined
    try {
      const systemPrompt = app.preferences.getItem<string>('themeSystemPrompt')
      settings = { ...await savedSettings(request.profileId), systemPrompt }
      let reply = ''
      let sampleMarkdown: string | undefined
      const progress = (change: ThemeModelEvent): void => {
        if (controller.signal.aborted) return
        if ('message' in change) reply = change.message
        if ('sampleMarkdown' in change) sampleMarkdown = change.sampleMarkdown
        if (!sender.isDestroyed()) sender.send('mt::theme::progress', request.id, change)
      }
      const css = withTools
        ? await runThemeTools(settings, request, controller.signal, progress, previewCaptureTool(sender, controller.signal, progress), trace)
        : await generateTheme(settings, request, controller.signal, progress, fetch, trace)
      controller.signal.throwIfAborted()
      return { css, reply, sampleMarkdown }
    } catch (cause) {
      if (controller.signal.aborted && controller.signal.reason?.name === 'AbortError') return { cancelled: true }
      if (!sender.isDestroyed()) {
        const reason = cause instanceof Error ? cause.message : 'requestFailed'
        const metadata = { time: new Date().toISOString(), requestId: request.id, model: settings?.model ?? request.profileId,
          requestType: settings?.requestType, phase: withTools ? 'tools' : 'text', reason,
          wireBytes: trace.wireBytes, replyBytes: trace.replyBytes }
        log.warn('Theme assistant request failed', metadata)
        return { diagnostic: {
          ...metadata, inputCss: request.css, assistantText: trace.assistantText
        } }
      }
      throw cause
    } finally {
      clearTimeout(timer)
      sender.removeListener('destroyed', abort)
      sender.removeListener('did-navigate', abort)
      sender.removeListener('render-process-gone', abort)
      pending.delete(senderId)
    }
  }
  ipcMain.handle('mt::theme::generate', (event, request: ThemeModelRequest) => generate(event, request, false))
  ipcMain.handle('mt::theme::generate-with-tools', (event, request: ThemeModelRequest) => generate(event, request, true))
  ipcMain.handle('mt::theme::summarize-version', async(event, profileId: string, locale: string, changes: ThemeVersionChange[]) => {
    requireModelWindow(app, event, WindowType.STUDIO, WindowType.EDITOR)
    if (typeof profileId !== 'string' || typeof locale !== 'string' || !/^[\w-]{1,40}$/.test(locale) ||
      !Array.isArray(changes) || !changes.length || changes.length > 24 || !changes.every(change =>
      change && ['name', 'base', 'css', 'sample'].includes(change.field) &&
        (change.location === undefined || typeof change.location === 'string' && change.location.length <= 200) &&
        [change.before, change.after].every(value => value === null || typeof value === 'string' && value.length <= 500))) {
      throw new Error('invalidRequest')
    }
    const diff = changes.map(({ field, location, before, after }) => ({ field, location, before, after }))
    return summarizeThemeVersion(await savedSettings(profileId), locale, diff)
  })
  ipcMain.handle('mt::theme::cancel', (event, id: string) => {
    requireModelWindow(app, event, WindowType.STUDIO, WindowType.EDITOR)
    const task = pending.get(event.sender.id)
    if (task && task.id === id) task.controller.abort()
  })

  function activeTheme() {
    const { theme: id, localThemes } = app.preferences.getAll()
    const source = localThemeList(localThemes).find(item => item.id === id)
    const target: SkillTheme = { id, name: source?.name ?? id, base: source?.base ?? id, scope: 'active' }
    const revision = createHash('sha256').update(JSON.stringify([id, source])).digest('hex')
    return { target, source, revision }
  }

  function history(): AppliedThemeHistory {
    const { target, source, revision } = activeTheme()
    return {
      themeId: target.id, revision,
      current: source ? appliedThemeSnapshot(source) : { name: target.name, base: target.base, css: '', sample: null },
      entries: source ? activeVersions.list(source) : []
    }
  }

  ipcMain.handle('mt::theme::active-history', event => {
    authorize(event, WindowType.EDITOR)
    return history()
  })
  ipcMain.handle('mt::theme::restore-active-version', (event, themeId: string, revision: string, version: string) => {
    authorize(event, WindowType.EDITOR)
    if (typeof version !== 'string' || version.length !== 36) throw new Error('invalidRequest')
    const current = activeTheme()
    if (current.target.id !== themeId || current.revision !== revision || !current.source) return null
    const entry = activeVersions.find(current.source, version)
    if (!entry) return null
    const saved = saveTheme(entry.theme, true, false, { before: current.source, kind: 'restore', restoredAt: entry.time })
    if (!saved) throw new Error('theme-save-failed')
    notifyStudio()
    return history()
  })

  return {
    read() {
      const { target, source, revision } = activeTheme()
      return { ...target, css: source?.css ?? '', revision }
    },
    edit(id, revision, css) {
      const current = activeTheme()
      const { target, source } = current
      if (target.id !== id || current.revision !== revision) throw new Error('theme-changed')
      if (themeCssIssue(css)) throw new Error('invalid-theme-css')
      if ((source?.css ?? '') === css) return { changed: false }
      const copy = !source || !!source.catalog
      const input: LocalTheme = {
        version: 1,
        id: copy ? `local:${target.base}:${randomUUID()}` : id,
        name: copy ? (target.name + ' · ' + t('studio.copy')).slice(0, maxThemeNameLength) : target.name,
        base: target.base,
        values: source?.values ?? {},
        css
      }
      if (!isLocalTheme(input)) throw new Error('invalid-theme-css')
      const saved = saveTheme(input, true, copy, { before: source, kind: 'collaboration' })
      if (!saved) throw new Error('theme-save-failed')
      notifyStudio()
      return { changed: true }
    }
  }
}
