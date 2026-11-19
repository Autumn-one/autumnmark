export const isDocumentBackground = (event: MouseEvent): boolean => {
  const { target, clientX, clientY } = event
  if (!(target instanceof Element)) return false
  if (target.matches('.document-body, .editor-wrapper, .mu-editor, .mu-container, .source-code')) return true

  if (target.closest('.source-code')) {
    if (target.matches('.CodeMirror, .CodeMirror-scroll, .CodeMirror-sizer, .CodeMirror-lines, .CodeMirror-code')) return true
    if (!target.closest('pre.CodeMirror-line')) return false
  } else {
    if (!target.closest('.mu-paragraph, .mu-atx-heading, .mu-setext-heading')) return false
    if (!target.matches('.mu-paragraph, .mu-atx-heading, .mu-setext-heading, .mu-content, .mu-line-end, br')) return false
  }

  // Both editors can deliver the same target for a glyph and for the space past the line end.
  const range = document.createRange()
  return !Array.from(target.childNodes).some(node => {
    if (node.nodeType !== Node.TEXT_NODE) return false
    range.selectNodeContents(node)
    return Array.from(range.getClientRects()).some(rect =>
      clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom)
  })
}
