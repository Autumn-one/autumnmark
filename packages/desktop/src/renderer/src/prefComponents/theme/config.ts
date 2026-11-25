import { themeBases, type LocalTheme } from '@shared/localTheme'
import { isDarkThemeId, pineInkTheme } from 'common/theme'
import type { ThemeCatalogSnapshot } from '@shared/themeCatalog'

export interface ThemeChoiceItem {
  key: string
  id?: string
  base: string
  name: string
  meta: string
  image?: string
  local?: LocalTheme
  remote?: ThemeCatalogSnapshot['themes'][number]
}

export const themes = [pineInkTheme.id, ...themeBases.filter(id => id !== pineInkTheme.id)]
  .sort((a, b) => Number(isDarkThemeId(a)) - Number(isDarkThemeId(b)))
  .map(name => ({ name }))

export const themeLabel = (name: string, library: LocalTheme[] = []): string => {
  const local = library.find(item => item.id === name)
  if (local) return local.name
  if (name === pineInkTheme.id) return pineInkTheme.name
  if (name === 'light') return 'GitBook Teal'
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
