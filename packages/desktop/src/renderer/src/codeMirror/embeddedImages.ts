import type CodeMirror from 'codemirror'
import { bindEmbeddedImageEvents, embeddedPictureSize, findEmbeddedMedia, replaceEmbeddedImage, type IEmbeddedImageEdit } from '@muyajs/core'

export function installEmbeddedImages(cm: CodeMirror.Editor, edit: (image: IEmbeddedImageEdit, event?: MouseEvent) => void, compact: (text: string) => string) {
  const widgets = new WeakSet<CodeMirror.TextMarker>()
  const refresh = (first: number, last: number) => cm.operation(() => {
    for (let line = first; line <= last; line++) {
      const text = cm.getLine(line)
      const markers = cm.findMarks({ line, ch: 0 }, { line, ch: text.length }).filter(m => widgets.has(m))
      for (const marker of markers) marker.clear()
      for (const image of findEmbeddedMedia(text)) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'embedded-image-chip'
        button.textContent = image.label
        if (image.kind === 'video') button.classList.add('embedded-video-chip')
        const marker = cm.markText({ line, ch: image.start }, { line, ch: image.end }, {
          replacedWith: button,
          handleMouseEvents: false,
          atomic: true
        })
        widgets.add(marker)
        const raw = text.slice(image.start, image.end)
        const activate = (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const range = marker.find()
          if (!range) return
          const { from } = range
          const end = (value: string) => ({ line: from.line, ch: from.ch + value.length })
          const matches = (expected: string) => {
            const previous = replaceEmbeddedImage(raw, image, expected)
            return cm.getRange(from, end(previous)) === previous
          }
          edit({
            src: image.src,
            kind: image.kind,
            readOnly: !!cm.getOption('readOnly'),
            name: image.name ?? /^!\[([^\]]*)\]/.exec(raw)?.[1] ?? '',
            matches,
            size: embeddedPictureSize(raw, image, (markup, expected) => {
              if (cm.getOption('readOnly') || !matches(expected)) return
              cm.replaceRange(markup, from, end(replaceEmbeddedImage(raw, image, expected)), 'embedded-image-size')
            }),
            undo: () => cm.undo(),
            apply: (src, expected = image.src) => {
              if (cm.getOption('readOnly') || !matches(expected)) return
              const previous = replaceEmbeddedImage(raw, image, expected)
              cm.replaceRange(replaceEmbeddedImage(raw, image, src), from, end(previous), 'embedded-image')
            }
          }, event)
        }
        bindEmbeddedImageEvents(button, activate)
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
    const text = change.text.join('\n')
    const packed = compact(text)
    if (packed !== text) change.update(from, to, packed.split('\n'))
    else if (from !== change.from || to !== change.to) change.update(from, to)
  }
  refresh(cm.firstLine(), cm.lastLine())
  cm.on('changes', changed)
  cm.on('beforeChange', expand)
  return () => {
    cm.off('changes', changed)
    cm.off('beforeChange', expand)
  }
}
