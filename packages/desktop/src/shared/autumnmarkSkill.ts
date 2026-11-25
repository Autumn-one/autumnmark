import type { LocalTheme } from './localTheme'

export const maxSkillMarkdownLength = 1_000_000

export interface SkillDocument {
  id: string
  name: string
  path: string
  editable: boolean
  active: boolean
}

export interface SkillTheme {
  id: string
  name: string
  base: string
  scope: 'draft' | 'active'
}

export interface SkillThemeSnapshot extends SkillTheme {
  css: string
  baseCss: string
  revision: string
}

export function appliedThemeRevisionInput(id: string, source: LocalTheme | undefined): string {
  return JSON.stringify([id, source])
}

export interface SkillThemeProbe {
  selector: string
  property: string
  occurrence: number
}

export interface SkillThemeMeasurement {
  matches: number
  value: string | null
  visible: boolean
}

export function isSkillThemeProbe(input: unknown): input is SkillThemeProbe {
  if (!input || typeof input !== 'object') return false
  const { selector, property, occurrence } = input as Partial<SkillThemeProbe>
  return typeof selector === 'string' && !!selector.trim() && selector.length <= 400 &&
    typeof property === 'string' && property.length <= 100 && /^(?:--[\w-]+|[a-z][a-z0-9-]*)$/.test(property) &&
    typeof occurrence === 'number' && Number.isSafeInteger(occurrence) && occurrence > 0
}

export type SkillWindowRequest =
  | { action: 'documents' }
  | { action: 'read-document'; id: string }
  | { action: 'edit-document'; id: string; revision: string; markdown: string }
  | { action: 'theme-info' }
  | { action: 'read-theme' }
  | { action: 'measure-theme'; id: string; probe: SkillThemeProbe }
  | { action: 'theme-workspace'; id: string }
  | { action: 'edit-theme'; id: string; revision: string; css: string }
  | { action: 'active-theme'; revision: string; query?: { base: string } | { probe: SkillThemeProbe } }

export type SkillWindowResponse = { ok: true; value: unknown } | { ok: false; error: string }
