import { Muya } from '@muyajs/core'
import '@muyajs/core/assets/styles/index.css'
import './assets/styles/index.css'
import CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/mode/markdown/markdown'
import 'codemirror/theme/railscasts.css'
import './assets/themes/codemirror/one-dark.css'
import './codeMirror/index.css'
import { builtinThemeCss } from './util/builtinTheme'
import { localThemeCss } from './util/themeOverrides'
import { isDarkThemeId } from 'common/theme'
import { isLocalTheme, themeBases } from '@shared/localTheme'
import { inspectSelectors } from './prefComponents/theme/selectorRules'
import { preparePreviewTarget } from './prefComponents/theme/previewTarget'
import { deferThemeDevUpdates } from './prefComponents/theme/devUpdates'

if (import.meta.hot) import.meta.hot.dispose(deferThemeDevUpdates(import.meta.hot))

const chrome = document.createElement('style')
chrome.textContent = `
html, body { height: auto; min-height: 100%; overflow: auto; }
html body { position: static; width: auto; margin: 0; color: var(--editorColor); background: var(--editorBgColor) !important; }
#sidebar { position: static; width: fit-content; margin: 12px clamp(16px, 5vw, 34px) 0 auto; padding: 2px 7px; border-radius: 4px; font-size: 11px; background: var(--sideBarBgColor); color: var(--sideBarTextColor); }
main { padding: 4px clamp(10px, 3vw, 22px) 12px; }
.mu-editor { min-height: 0; }
.mu-container { padding-inline: clamp(22px, 5vw, 40px); padding-block-end: 48px; }
.source-code { padding: 10px; min-height: 100vh; }
body.catalog-preview { display: grid; grid-template: auto 1fr / minmax(96px, 20%) minmax(0, 1fr); }
body.catalog-preview #preview-tab {
  grid-column: 1 / -1; padding: 6px 12px; font-size: 12px; color: var(--sideBarColor);
  background: var(--sideBarBgColor); border-bottom: 1px solid var(--editorColor10);
}
body.catalog-preview #sidebar {
  grid-row: 2; width: auto; margin: 0; border-radius: 0; padding: 9px 7px;
  color: var(--sideBarColor); border-inline-end: 1px solid var(--editorColor10); overflow-wrap: anywhere;
}
#preview-sidebar-file {
  display: block; margin-top: 6px; padding: 5px; border-radius: 4px;
  background: var(--itemBgColor); color: var(--sideBarTitleColor);
}
body.catalog-preview :is(main, .source-code) { grid-area: 2 / 2; min-width: 0; min-height: 0; }
body.catalog-preview .mu-container { max-width: 680px; margin-inline: auto; padding-inline: clamp(9px, 3vw, 22px); padding-block-end: 20px; }
@media (max-width: 490px) {
  body.catalog-preview { grid-template-columns: minmax(0, 1fr); }
  body.catalog-preview #sidebar { display: none; }
  body.catalog-preview :is(main, .source-code) { grid-column: 1; }
}
[hidden] { display: none !important; }
`
const sheet = document.createElement('style')
document.head.append(chrome, sheet)
const sidebarLabel = document.getElementById('preview-sidebar-label')
const filenameLabels = document.querySelectorAll<HTMLElement>('#preview-tab, #preview-sidebar-file')
const muya = new Muya(document.querySelector<HTMLElement>('#editor')!, { markdown: '', readOnly: true, hideQuickInsertHint: true })
muya.init({ focus: false })
const cm = CodeMirror.fromTextArea(document.querySelector('textarea')!, { readOnly: 'nocursor', lineWrapping: true, mode: 'markdown' })
let lastMarkdown: string | null = null
let demo = false
let inspectClicks = false
const post = (data: object): void => parent.postMessage(data, '*')
let inspectedElement: Element | null = null
let draftCss = ''
const selectionAttributes = new MutationObserver(reportSelectors)

function reportSelectors(): void {
  if (!inspectedElement?.isConnected) {
    selectionAttributes.disconnect()
    inspectedElement = null
  }
  const choices = inspectedElement ? inspectSelectors(inspectedElement, draftCss) : []
  post({ type: 'theme-preview-selectors', choices, css: draftCss })
}
window.addEventListener('autumnmark-inspected-element', event => {
  const element: unknown = (event as CustomEvent).detail
  selectionAttributes.disconnect()
  inspectedElement = element instanceof Element && element.ownerDocument === document ? element : null
  if (inspectedElement) selectionAttributes.observe(inspectedElement, { attributes: true, attributeFilter: ['class', 'id'] })
  if (inspectClicks) reportSelectors()
})
window.addEventListener('message', event => {
  const data = event.data
  if (event.source !== parent) return
  if (data?.type === 'theme-preview-inspector') {
    inspectClicks = data.open === true
    if (inspectClicks) reportSelectors()
    else {
      inspectedElement = null
      selectionAttributes.disconnect()
    }
    return
  }
  if (data?.type !== 'theme-preview' ||
    typeof data.markdown !== 'string' || typeof data.sidebar !== 'string') return
  const local = isLocalTheme(data.theme) ? data.theme : undefined
  const base = local?.base ?? (typeof data.theme === 'string' && themeBases.includes(data.theme) ? data.theme : undefined)
  if (!base) return
  sheet.textContent = builtinThemeCss(base) + '\n' + localThemeCss(local)
  document.body.classList.toggle('dark', isDarkThemeId(base))
  const filename = typeof data.filename === 'string' ? data.filename : ''
  document.body.classList.toggle('catalog-preview', !!filename)
  if (sidebarLabel) sidebarLabel.textContent = data.sidebar
  for (const label of filenameLabels) {
    label.textContent = filename
    label.hidden = !filename
  }
  const nextDemo = data.demo === true
  if (nextDemo !== demo) muya.setOptions({ footnote: nextDemo, githubAlerts: nextDemo, highlightSyntax: nextDemo })
  if (lastMarkdown !== data.markdown || nextDemo !== demo) {
    muya.setContent(data.markdown)
    cm.setValue(data.markdown)
    lastMarkdown = data.markdown
    demo = nextDemo
  }
  document.querySelector('main')!.hidden = data.source
  document.querySelector<HTMLElement>('.source-code')!.hidden = !data.source
  cm.setOption('theme', base === 'one-dark' ? 'one-dark' : isDarkThemeId(base) ? 'railscasts' : 'default')
  if (data.source) cm.refresh()
  const css = local?.css ?? ''
  const changed = css !== draftCss || (inspectedElement && !inspectedElement.isConnected)
  draftCss = css
  if (changed && inspectClicks) reportSelectors()
  const paintPort = event.ports[0]
  if (paintPort && data.captureTarget) void preparePreviewTarget(data.captureTarget, paintPort)
})
document.addEventListener('click', event => {
  if (inspectClicks && event.button === 0 && event.detail > 0) {
    event.preventDefault()
    event.stopImmediatePropagation()
    post({ type: 'theme-preview-point', x: event.clientX, y: event.clientY })
    return
  }
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
}, true)
document.addEventListener('keydown', event => {
  if (!document.body.classList.contains('catalog-preview') || event.isComposing) return
  const space = event.key === ' ' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  if (event.key === 'Escape' || space) {
    event.preventDefault()
    event.stopPropagation()
    post({ type: 'theme-preview-dismiss' })
  }
}, true)
post({ type: 'theme-preview-ready' })
