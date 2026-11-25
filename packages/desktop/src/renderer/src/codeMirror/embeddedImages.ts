import CodeMirror from 'codemirror'
import { bindEmbeddedImageEvents, embeddedPictureSize, findEmbeddedMedia, replaceEmbeddedImage, type IEmbeddedImageEdit } from '@muyajs/core'

interface SourceDrawing {
  start: number
  end: number
  label: string
  open: () => void
}

export function installEmbeddedImages(
  cm: CodeMirror.Editor,
  edit: (image: IEmbeddedImageEdit, event?: MouseEvent) => void,
  compact: (text: string) => string,
  findDrawings: (markdown: string) => SourceDrawing[]
) {
  const widgets = new WeakSet<CodeMirror.TextMarker>()
  const drawingWidgets = new Set<CodeMirror.TextMarker>()
  const refreshDrawings = () => {
    const drawings = findDrawings(cm.getValue()).sort((a, b) => a.start - b.start || b.end - a.end)
    for (const marker of drawingWidgets) marker.clear()
    drawingWidgets.clear()
    let previousEnd = 0
    for (const drawing of drawings) {
      if (drawing.start < previousEnd) continue
      const from = cm.posFromIndex(drawing.start)
      const to = cm.posFromIndex(drawing.end)
      for (const marker of cm.findMarks(from, to)) {
        if (widgets.has(marker)) marker.clear()
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'embedded-image-chip embedded-drawing-chip'
      button.textContent = drawing.label
      button.onclick = event => {
        event.preventDefault()
        event.stopPropagation()
        drawing.open()
      }
      const marker = cm.markText(from, to, { replacedWith: button, handleMouseEvents: false, atomic: true })
      drawingWidgets.add(marker)
      previousEnd = drawing.end
    }
  }

  const refresh = (first: number, last: number) => cm.operation(() => {
    refreshDrawings()
    for (let line = first; line <= last; line++) {
      const text = cm.getLine(line)
      const markers = cm.findMarks({ line, ch: 0 }, { line, ch: text.length }).filter(m => widgets.has(m))
      for (const marker of markers) marker.clear()
      for (const image of findEmbeddedMedia(text)) {
        const from = { line, ch: image.start }
        const to = { line, ch: image.end }
        if (cm.findMarks(from, to).some(marker => drawingWidgets.has(marker))) continue
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'embedded-image-chip'
        button.textContent = image.label
        if (image.kind === 'video') button.classList.add('embedded-video-chip')
        const marker = cm.markText(from, to, {
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
      const drawing = drawingWidgets.has(marker)
      // Drawing saves replace the scene inside the marker through the document edit API.
      if (drawing ? change.origin === 'document-edit' : !widgets.has(marker)) continue
      const range = marker.find()
      if (!range || !('from' in range)) continue
      if (CodeMirror.cmpPos(range.from, to) >= 0 || CodeMirror.cmpPos(range.to, from) <= 0) continue
      if (CodeMirror.cmpPos(range.from, from) < 0) from = range.from
      if (CodeMirror.cmpPos(range.to, to) > 0) to = range.to
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
