import editorStyle from '@muyajs/core/assets/styles/index.css?inline'
import blockStyle from '@muyajs/core/assets/styles/blockSyntax.css?inline'
import inlineStyle from '@muyajs/core/assets/styles/inlineSyntax.css?inline'
import baseStyle from '@/assets/styles/index.css?inline'
import { isDarkThemeId, themeBaseId } from 'common/theme'
import type { LocalTheme } from '@shared/localTheme'
import { localThemeCss } from '@shared/themeOverrides'
import { builtinThemeCss } from '@/util/builtinTheme'

const thumbnailStyle = `
html, body { overflow: hidden; }
html body { color: var(--editorColor); background: var(--editorBgColor) !important; }
.swatch { display: grid; place-items: center; height: 100%; font: 16px Georgia, serif; }
.mu-editor { --mu-font-size: 16px; --mu-line-height: 1.4; zoom: 0.66; }
.mu-container { max-width: none; padding: 12px 15px; }
.mu-container > :is(h1, p, blockquote), .mu-container blockquote > p {
  margin-block: 0 6px !important;
}
.mu-container > h1 { padding-block: 0.2em !important; }
.mu-container > h1 > .mu-content {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap !important;
}
.mu-container > blockquote { padding-block: 3px !important; }
.mu-container blockquote > p { margin-block-end: 0 !important; }
.mu-container > .mu-table { margin: 0 0 6px; padding: 0; overflow: hidden; }
.mu-container .mu-table-inner { margin: 0; }
.mu-container .mu-table-inner :is(th, td) { padding-block: 3px; }
`

export function themeThumbnailDocument(id: string, local?: LocalTheme, sample?: string): string {
  const base = local?.base ?? themeBaseId(id)
  const theme = builtinThemeCss(base) + '\n' + localThemeCss(local)
  // A CSS string or comment can contain an HTML end tag.
  const styles = [blockStyle, inlineStyle, editorStyle, baseStyle, thumbnailStyle, theme]
    .join('\n').replace(/<(?=\/style\b)/gi, '\\3c ')
  const content = sample ?? '<span class="swatch">Aa</span>'
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src data:">
    <style>${styles}</style></head><body class="${isDarkThemeId(base) ? 'dark' : ''}">${content}</body></html>`
}
