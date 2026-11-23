import { parse, type AnyNode, type AtRule, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { maxThemeCss } from '@shared/themeCss'

export interface SelectorChoice {
  selector: string
  offset: number | null
}

type SelectorPart = { type: 'class' | 'id' | 'tag'; value: string }

function subjectHasPart(selector: selectorParser.Selector, part: SelectorPart): boolean {
  for (let index = selector.nodes.length - 1; index >= 0; index--) {
    const node = selector.nodes[index]
    if (node.type === 'combinator') break
    if (node.type === part.type && node.value === part.value) return true
    if (node.type === 'pseudo' && [':is', ':where'].includes(node.value) &&
      node.nodes.some(branch => subjectHasPart(branch, part))) return true
  }
  return false
}

function scopeRootFor(element: Element, scope: AtRule): Element | null {
  const sheet = new CSSStyleSheet()
  try {
    sheet.insertRule('@scope ' + scope.params + ' {}')
    const bounds = sheet.cssRules[0] as CSSScopeRule
    const root = bounds.start ? element.closest(bounds.start) : element.ownerDocument.documentElement
    const limit = bounds.end ? element.closest(bounds.end) : null
    return limit && root?.contains(limit) ? null : root
  } catch { return null }
}

function bodyOffset(rule: Rule, css: string): number {
  const start = (rule.source?.start?.offset ?? 0) + (rule.source?.input.hasBOM ? 1 : 0)
  const selector = rule.raws.selector?.raw ?? rule.selector
  const brace = start + selector.length + (rule.raws.between?.length ?? 0)
  const whitespace = css.slice(brace + 1).match(/^[ \t]*(?:\r?\n[ \t]*)?/)?.[0] ?? ''
  return brace + 1 + whitespace.length
}

export function inspectSelectors(element: Element, css: string): SelectorChoice[] {
  const parts: SelectorPart[] = Array.from(element.classList, value => ({ type: 'class', value }))
  if (!parts.length) parts.push(element.id ? { type: 'id', value: element.id } : { type: 'tag', value: element.localName })
  const prefix = { class: '.', id: '#', tag: '' }
  const choices: SelectorChoice[] = parts.map(part => ({
    selector: prefix[part.type] + CSS.escape(part.value), offset: null
  }))
  const scores = parts.map(() => Infinity)
  const parents = new Map<Rule, { ast: selectorParser.Root; size: number }>()
  const scopeRoots = new Map<AtRule, Element | null>()
  parse(css, { from: undefined }).walkRules(rule => {
    let ast: selectorParser.Root
    try { ast = selectorParser().astSync(rule.selector) } catch { return }
    let ancestor = rule.parent
    while (ancestor?.type === 'atrule') ancestor = ancestor.parent
    const parent = ancestor?.type === 'rule' ? parents.get(ancestor) : undefined
    if (ancestor?.type === 'rule' && !parent) return
    let size = rule.selector.length
    if (parent) {
      for (const selector of ast.nodes) {
        const references: selectorParser.Nesting[] = []
        selector.walkNesting(node => { references.push(node) })
        // Repeated ampersands can expand a short nested selector exponentially.
        size += Math.max(1, references.length) * (parent.size + 6)
        if (size > maxThemeCss) return
        const parentSelector = () => selectorParser.pseudo({ value: ':is', nodes: parent.ast.nodes.map(node => node.clone()) })
        for (const node of references) node.replaceWith(parentSelector())
        if (!references.length) {
          selector.prepend(selectorParser.combinator({ value: ' ' }))
          selector.prepend(parentSelector())
        }
      }
    }
    if (rule.nodes.some(node => node.type === 'rule' || (node.type === 'atrule' && node.nodes))) parents.set(rule, { ast, size })
    let scope: Element | undefined
    for (let node: AnyNode | undefined = rule.parent; node && node.type !== 'root'; node = node.parent) {
      if (node.type !== 'atrule' || node.name !== 'scope') continue
      if (!scopeRoots.has(node)) scopeRoots.set(node, scopeRootFor(element, node))
      const root = scopeRoots.get(node)
      if (!root || (scope && !root.contains(scope))) return
      scope ??= root
    }
    for (const selector of ast.nodes) {
      const text = selector.toString().trim()
      let matches: boolean
      try {
        matches = scope && scope !== element && text.includes(':scope')
          ? Array.from(scope.querySelectorAll(text)).includes(element)
          : element.matches(text)
      } catch { continue }
      if (!matches) continue
      parts.forEach((part, index) => {
        if (!subjectHasPart(selector, part)) return
        const score = (rule.parent?.type === 'root' ? 0 : 2) + (text === choices[index].selector ? 0 : 1)
        if (score <= scores[index]) {
          scores[index] = score
          choices[index].offset = bodyOffset(rule, css)
        }
      })
    }
  })
  return choices
}
