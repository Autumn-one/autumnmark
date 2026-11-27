import { getThemeBackgroundColor, isDarkThemeId } from '../../common/theme'
import { localThemeList } from '@shared/localTheme'
import { themeWindowBackground } from '@shared/themeCss'
import type { UserPreferences } from '@shared/types/preferences'

export type NativeThemeSource = 'system' | 'dark' | 'light'

export const isDarkApplicationTheme = (theme: unknown): boolean => {
  return isDarkThemeId(theme)
}

export const resolveThemeBackground = (theme: unknown, library?: UserPreferences['localThemes']): string => {
  const local = localThemeList(library).find(item => item.id === theme)
  // Until the renderer evaluates the cascade, only literal CSS colors are available.
  const background = local?.css ? themeWindowBackground(local.css) : undefined
  return background ?? local?.values.background ?? getThemeBackgroundColor(typeof theme === 'string' ? theme : undefined)
}

const linearChannel = (color: string): number => {
  const channel = Number.parseInt(color, 16) / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

export const getNativeThemeSource = ({
  followSystemTheme,
  theme,
  localThemes
}: {
  followSystemTheme?: boolean
  theme?: unknown
  localThemes?: UserPreferences['localThemes']
}): NativeThemeSource => {
  if (followSystemTheme) {
    return 'system'
  }
  const background = resolveThemeBackground(theme, localThemes)
  if (!/^#[\da-f]{6}$/i.test(background)) return isDarkApplicationTheme(theme) ? 'dark' : 'light'

  const luminance =
    0.2126 * linearChannel(background.slice(1, 3)) +
    0.7152 * linearChannel(background.slice(3, 5)) +
    0.0722 * linearChannel(background.slice(5, 7))
  // Black and white text have equal contrast around this relative luminance.
  return luminance < 0.179 ? 'dark' : 'light'
}
