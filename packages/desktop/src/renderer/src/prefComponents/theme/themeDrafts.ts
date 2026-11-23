import { isLocalTheme, isThemeSample, type LocalTheme } from '@shared/localTheme'
import { localThemeCss } from '@/util/themeOverrides'

export const themeDraftPrefix = 'autumnmark.theme-draft.v1.'

export interface ThemeDraft extends LocalTheme { previewCss?: string }
export interface ThemeDraftEntry { key: string; draft: ThemeDraft }
export interface ThemeLibraryItem { id: string; key: string; name: string; base: string; saved: boolean; changed?: boolean }

export function readThemeDraft(key: string, storage = localStorage): ThemeDraftEntry | undefined {
  if (!key.startsWith(themeDraftPrefix) || /\.(sample|chat|collaboration)$/.test(key)) return
  try {
    const draft = JSON.parse(storage.getItem(key) ?? 'null')
    if (draft && typeof draft.name === 'string' && (draft.css === undefined || typeof draft.css === 'string') &&
      isLocalTheme({ ...draft, name: draft.name.trim() || 'Draft', css: '' })) return { key, draft }
  } catch { /* Other saved drafts are still available when one entry is malformed. */ }
}

export function removeThemeDraft(key: string): void {
  for (const suffix of ['', '.sample', '.chat', '.collaboration']) {
    localStorage.removeItem(key + suffix)
  }
  const promptPrefix = key + '.chat.input.'
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const storedKey = sessionStorage.key(index)
    if (storedKey?.startsWith(promptPrefix)) sessionStorage.removeItem(storedKey)
  }
}

export function listThemeDrafts(): ThemeDraftEntry[] {
  const drafts: ThemeDraftEntry[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key) continue
    const entry = readThemeDraft(key)
    if (entry) drafts.push(entry)
  }
  return drafts
}

export function editableTheme(theme: LocalTheme): LocalTheme {
  const { version, id, name, base } = theme
  return { version, id, name, base, css: localThemeCss(theme), values: {} }
}

export function newThemeDraft(name: string, base: string, source?: LocalTheme, key?: string): ThemeDraftEntry {
  const uuid = crypto.randomUUID()
  return { key: key ?? themeDraftPrefix + 'new.' + uuid,
    draft: { version: 1, id: 'local:' + base + ':' + uuid, base, name, values: {}, css: localThemeCss(source) } }
}

export function readDraftSample(key: string): string | null {
  const sample = localStorage.getItem(key + '.sample')
  return isThemeSample(sample) ? sample : null
}
