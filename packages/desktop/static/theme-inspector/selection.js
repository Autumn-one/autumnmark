/* global chrome */
const inspected = chrome.devtools.inspectedWindow
const previewURL = 'location.pathname.endsWith("/theme-studio.html") ? new URL("theme-preview.html", location.href).href : null'
inspected.eval(previewURL, (frameURL, exception) => {
  if (exception || !frameURL) return
  // Evaluate in the preview's realm so selections in the surrounding studio clear the previous target.
  const publish = () => inspected.eval(`(() => {
    const node = typeof $0 !== 'undefined' ? $0 : null
    const element = node?.nodeType === 1 ? node : node?.parentElement
    window.dispatchEvent(new CustomEvent('autumnmark-inspected-element', {
      detail: element?.ownerDocument === document ? element : null
    }))
  })()`, { frameURL })
  chrome.devtools.panels.elements.onSelectionChanged.addListener(publish)
  publish()
})
