import baseStyle from '@/assets/styles/index.css?inline'
import { themeBaseId } from 'common/theme'
import type { LocalTheme } from '@shared/localTheme'
import { localThemeCss } from '@shared/themeOverrides'
import { builtinThemeCss } from '@/util/builtinTheme'

export const themePreviewStyle = (id: string, local?: LocalTheme): Record<string, string> => {
  const source = baseStyle + builtinThemeCss(local?.base ?? themeBaseId(id)) + '\n' + localThemeCss(local)
  const variables = new Map<string, string>()
  for (const match of source.matchAll(/--(editorBgColor|editorColor|themeColor|codeBgColor)\s*:\s*([^;]+);/g)) {
    variables.set(match[1], match[2].trim())
  }
  return {
    backgroundColor: variables.get('editorBgColor') ?? 'transparent',
    color: variables.get('editorColor') ?? 'inherit',
    '--preview-link': variables.get('themeColor') ?? 'currentColor',
    '--preview-heading': variables.get('themeColor') ?? 'currentColor',
    '--preview-code': variables.get('codeBgColor') ?? 'transparent',
    '--preview-tint': 'color-mix(in srgb, currentColor 7%, transparent)',
    '--preview-border': 'color-mix(in srgb, currentColor 17%, transparent)'
  }
}
