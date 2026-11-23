import { describe, expect, it } from 'vitest'
import { inspectSelectors } from '../../../src/renderer/src/prefComponents/theme/selectorRules'

function element(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'preview'
  host.innerHTML = '<h2 class="heading accent">Heading</h2>'
  return host.children[0] as HTMLElement
}

describe('theme CSS selector navigation', () => {
  it('finds the subject in a qualified selector list and preserves the declaration offset', () => {
    const css = 'h1.heading { color: red }\r\n.preview h2.heading, h3.title /* group */ {\r\n  padding: 1em;\r\n}'
    expect(inspectSelectors(element(), css)).toEqual([
      { selector: '.heading', offset: css.indexOf('padding') }, { selector: '.accent', offset: null }
    ])
  })
  it('prefers a dedicated rule and ignores class names in comments, values and unrelated targets', () => {
    const css = '.heading { color: blue; }\n.heading + h2, .heading span { color: orange; }\n' +
      'h2.heading.accent { content: ".heading" }\n/* .heading {} */'
    expect(inspectSelectors(element(), css)[0].offset).toBe(css.indexOf('color: blue'))
    expect(inspectSelectors(element(), 'h2:not(.accent), .accent h2 { color: red }')[1].offset).toBeNull()
  })
  it('recognizes nested rules targeting the selected element', () => {
    const css = '.preview { & > h2:is(.heading,.title) { margin: 0 } }'
    expect(inspectSelectors(element(), css)[0].offset).toBe(css.indexOf('margin'))
  })
  it('locates scoped heading rules relative to the preview container', () => {
    const css = '@scope (.preview) to (table) { :scope > h2.heading { padding: 8px; } }\n' +
      '@scope (.outside) { .heading { padding: 2px; } }'
    expect(inspectSelectors(element(), css)[0].offset).toBe(css.indexOf('padding: 8px'))
  })
  it('escapes class identifiers and offers an ID or tag for classless nodes', () => {
    const node = element()
    node.className = 'a:b'
    expect(inspectSelectors(node, '.a\\:b {}')).toEqual([{ selector: '.a\\:b', offset: 7 }])
    node.className = ''
    node.id = 'a:b'
    expect(inspectSelectors(node, '')[0].selector).toBe('#a\\:b')
    node.removeAttribute('id')
    expect(inspectSelectors(node, '')[0].selector).toBe('h2')
  })
})
