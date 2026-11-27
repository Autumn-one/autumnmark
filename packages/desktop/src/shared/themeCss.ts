import { parse, CssSyntaxError } from 'postcss'
import { tokenize, isTokenAtKeyword, isTokenBadURL, isTokenFunction, isTokenURL } from '@csstools/css-tokenizer'

export const maxThemeCss = 64 * 1024
const resourceFunctions = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set'])

export function themeCssIssue(css: string): string {
  if (css.length > maxThemeCss) return '64 KiB'
  try {
    let malformed = false
    const tokens = tokenize({ css }, { onParseError: () => { malformed = true } })
    if (malformed) return 'CSS'
    for (const token of tokens) {
      if (isTokenURL(token) || isTokenBadURL(token)) return 'url()'
      if (isTokenFunction(token) && resourceFunctions.has(token[4].value.toLowerCase())) return token[4].value + '()'
      if (isTokenAtKeyword(token) && ['import', 'namespace'].includes(token[4].value.toLowerCase())) return '@' + token[4].value
    }
    const root = parse(css, { from: undefined })
    if (root.nodes.some(node => node.type === 'decl')) return 'CSS'
    return ''
  } catch (error) {
    return error instanceof CssSyntaxError ? `${error.line}:${error.column} · ${error.reason}` : 'CSS'
  }
}

/** BrowserWindow needs a literal color before the renderer can resolve the theme cascade. */
export function themeWindowBackground(css: string): string | undefined {
  let color: string | undefined
  for (const node of parse(css).nodes) {
    if (node.type !== 'rule' || node.selector !== ':root') continue
    for (const item of node.nodes) {
      if (item.type !== 'decl' || item.prop !== '--editorBgColor') continue
      const value = item.value.trim()
      color = /^#[\da-f]{6}$/i.test(value) ? value : undefined
    }
  }
  return color
}

/** An empty match appends a rule. Replacements must locate exactly one passage in the current source. */
export function editThemeCss(source: string, find: string, replace: string): string {
  let next: string
  if (find) {
    const start = source.indexOf(find)
    if (start < 0) throw new Error('invalidReply:missingMatch')
    if (start !== source.lastIndexOf(find)) throw new Error('invalidReply:ambiguousMatch')
    next = source.slice(0, start) + replace + source.slice(start + find.length)
  } else {
    next = source && replace ? source + '\n\n' + replace : source + replace
  }
  const issue = themeCssIssue(next)
  if (issue) throw new Error('invalidReply:css · ' + issue)
  return next
}
