import { isCatalogThemeSource, maxThemeNameLength, themeBases, type CatalogThemeSource } from './localTheme'

export const themeCatalogBase = 'https://raw.githubusercontent.com/Autumn-one/autumnmark-theme/main/'

export interface CatalogTheme extends CatalogThemeSource {
  name: string
  author: string
  base: string
  path: string
  sha256: string
  preview?: string
  minAppVersion?: string
}

export type ThemeCatalogSnapshot = {
  themes: (CatalogTheme & { compatible: boolean })[]
  status: 'ready' | 'cached' | 'unavailable'
}

const relativeAsset = (value: unknown, extension: RegExp): value is string =>
  typeof value === 'string' && value.length <= 240 &&
  /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(value) && extension.test(value)

const version = /^(\d+)\.(\d+)\.(\d+)$/

export const parseThemeCatalog = (value: unknown): CatalogTheme[] => {
  if (!value || typeof value !== 'object') throw new Error('Invalid theme catalog')
  const manifest = value as { version?: unknown; themes?: unknown }
  if (manifest.version !== 1 || !Array.isArray(manifest.themes) || manifest.themes.length > 500)
    throw new Error('Invalid theme catalog')

  const ids = new Set<string>()
  return manifest.themes.map((entry: unknown) => {
    if (!isCatalogThemeSource(entry)) throw new Error('Invalid online theme')
    const { id, revision, name, author, base, path, sha256, preview, minAppVersion } = entry as Partial<CatalogTheme> & CatalogThemeSource
    if (ids.has(id) || typeof name !== 'string' || !name.trim() || name.length > maxThemeNameLength ||
      typeof author !== 'string' || !author.trim() || author.length > maxThemeNameLength ||
      typeof base !== 'string' || !themeBases.includes(base) ||
      !relativeAsset(path, /\.theme\.json$/i) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) ||
      (preview !== undefined && !relativeAsset(preview, /\.(png|webp)$/i)) ||
      (minAppVersion !== undefined && (typeof minAppVersion !== 'string' || !version.test(minAppVersion)))) {
      throw new Error('Invalid online theme')
    }
    ids.add(id)
    return { id, revision, name: name.trim(), author: author.trim(), base, path, sha256: sha256.toLowerCase(), preview, minAppVersion }
  })
}

export const supportsCatalogTheme = (theme: CatalogTheme, appVersion: string): boolean => {
  if (!theme.minAppVersion) return true
  const current = version.exec(appVersion.split('-')[0])?.slice(1).map(Number)
  const required = version.exec(theme.minAppVersion)?.slice(1).map(Number)
  if (!current || !required) return false
  const difference = current.map((number, index) => number - required[index]).find(number => number !== 0)
  return difference === undefined || difference > 0
}
