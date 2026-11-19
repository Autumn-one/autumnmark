import type CodeMirror from 'codemirror'
import { findEmbeddedImages, replaceEmbeddedImage, type IEmbeddedImageEdit } from '@muyajs/core'

export function installEmbeddedImages(cm: CodeMirror.Editor, edit: (image: IEmbeddedImageEdit) => void) {
  const widgets = new WeakSet<CodeMirror.TextMarker>()
  const refresh = (first: number, last: number) => cm.operation(() => {
    for (let line = first; line <= last; line++) {
      const text = cm.getLine(line)
      const markers = cm.findMarks({ line, ch: 0 }, { line, ch: text.length }).filter(m => widgets.has(m))
      for (const marker of markers) marker.clear()
      for (const image of findEmbeddedImages(text)) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'embedded-image-chip'
        button.textContent = image.label
        const marker = cm.markText({ line, ch: image.start }, { line, ch: image.end }, {
          replacedWith: button,
          handleMouseEvents: false,
          atomic: true
        })
        widgets.add(marker)
        const raw = text.slice(image.start, image.end)
        button.onclick = () => edit({
          src: image.src,
          apply: (src) => {
            const range = marker.find()
            if (!range || cm.getRange(range.from, range.to) !== raw || cm.getOption('readOnly')) return
            const next = replaceEmbeddedImage(raw, image, src)
            cm.replaceRange(next, range.from, range.to, 'embedded-image')
            cm.focus()
          }
        })
      }
    }
  })

  const changed = (_cm: CodeMirror.Editor, changes: CodeMirror.EditorChange[]) => {
    if (changes.length === 1) {
      const [change] = changes
      refresh(change.from.line, change.from.line + change.text.length - 1)
    } else {
      refresh(cm.firstLine(), cm.lastLine())
    }
  }
  const expand = (_cm: CodeMirror.Editor, change: CodeMirror.EditorChangeCancellable) => {
    if (!change.update || change.origin === 'setValue' || change.origin === 'undo' || change.origin === 'redo') return
    let { from, to } = change
    for (const marker of cm.findMarks(from, to)) {
      if (!widgets.has(marker)) continue
      const range = marker.find()
      if (!range || !('from' in range)) continue
      if (range.from.line === from.line && range.from.ch < from.ch) from = range.from
      if (range.to.line === to.line && range.to.ch > to.ch) to = range.to
    }
    if (from !== change.from || to !== change.to) change.update(from, to)
  }
  refresh(cm.firstLine(), cm.lastLine())
  cm.on('changes', changed)
  cm.on('beforeChange', expand)
  return () => {
    cm.off('changes', changed)
    cm.off('beforeChange', expand)
  }
}
