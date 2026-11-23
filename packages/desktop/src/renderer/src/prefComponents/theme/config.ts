import { themeBases, type LocalTheme } from '@shared/localTheme'
import { isDarkThemeId } from 'common/theme'
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

export const themes = themeBases.map(name => ({ name })).sort((a, b) => Number(isDarkThemeId(a.name)) - Number(isDarkThemeId(b.name)))

export const themeLabel = (name: string, library: LocalTheme[] = []): string => {
  const local = library.find(item => item.id === name)
  if (local) return local.name
  if (name === 'light') return 'GitBook Teal'
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
