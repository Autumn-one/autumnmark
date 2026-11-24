import { findDocumentImages } from '@muyajs/core'
import { applyMarkdownEdits } from '@shared/markdownEdits'
import { imageDestinationEdits } from '@/util/documentImages'
import { resolveDrawingPath } from '@/util/drawingPaths'

const pending = new Map<string, Promise<string>>()

function preview(path: string): Promise<string> {
  const loading = pending.get(path)
  if (loading) return loading
  const request = import('./drawingScene').then(module => module.renderDrawingPreview(path)).finally(() => {
    if (pending.get(path) === request) pending.delete(path)
  })
  pending.set(path, request)
  return request
}

export const invalidateDrawingPreviews = () => pending.clear()

export function resolveDrawingPreview(src: string, documentPath?: string | null) {
  const path = resolveDrawingPath(src, documentPath)
  if (path) return { key: path, load: () => preview(path) }
}

export async function expandDrawingPreviews(markdown: string, documentPath?: string | null): Promise<string> {
  if (!documentPath || !/excalidraw/i.test(markdown)) return markdown
  const converted = new Map<string, string>()
  const sources = new Set(findDocumentImages(markdown).map(image => image.src))
  await Promise.all([...sources].map(async src => {
    const path = resolveDrawingPath(src, documentPath)
    if (!path) return
    try {
      converted.set(src, await preview(path))
    } catch {
      // Keeping the original reference preserves its alt text if the drawing becomes unavailable.
    }
  }))
  return applyMarkdownEdits(markdown, imageDestinationEdits(markdown, converted))
}
