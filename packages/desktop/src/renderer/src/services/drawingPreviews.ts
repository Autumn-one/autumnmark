import { decodeInlineDrawing, findDocumentImages, isInlineDrawingSource } from '@muyajs/core'
import { applyMarkdownEdits } from '@shared/markdownEdits'
import { imageDestinationEdits } from '@/util/documentImages'
import { resolveDrawingPath } from '@/util/drawingPaths'
import type { DrawingScene } from './drawingScene'

interface LinkedDrawingFingerprint {
  drawingStat: string
  cardPaths: string[]
  cardStats: Map<string, string>
}

const pending = new Map<string, Promise<string>>()
const fingerprints = new Map<string, LinkedDrawingFingerprint>()

async function statToken(path: string): Promise<string> {
  try {
    const stat = await window.fileUtils.stat(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

function cardPathsForScene(drawingPath: string, scene?: DrawingScene): string[] {
  if (!scene) return []
  const paths = new Set<string>()
  for (const element of scene.elements) {
    if (element.type !== 'image' || element.isDeleted) continue
    const reference: unknown = element.customData?.autumnmarkDocument
    if (!reference || typeof reference !== 'object' || !('path' in reference) || typeof reference.path !== 'string') continue
    const { path } = reference
    if (!path || /^(?:[a-z][\w+.-]*:|[/\\])/i.test(path) || path.includes('\0') || !window.fileUtils.hasMarkdownExtension(path)) continue
    paths.add(window.path.resolve(window.path.dirname(drawingPath), path))
  }
  return [...paths].sort()
}

export async function recordLinkedDrawingFingerprint(path: string, scene?: DrawingScene): Promise<void> {
  const drawingStat = await statToken(path)
  const cardPaths = cardPathsForScene(path, scene)
  const cardEntries = await Promise.all(cardPaths.map(async cardPath => [cardPath, await statToken(cardPath)] as const))
  fingerprints.set(path, {
    drawingStat,
    cardPaths,
    cardStats: new Map(cardEntries)
  })
}

// Missing fingerprints always return true so the initial focus or load never skips rendering.
export async function hasLinkedDrawingChanged(path: string): Promise<boolean> {
  const previous = fingerprints.get(path)
  if (!previous) return true
  const currentDrawingStat = await statToken(path)
  if (currentDrawingStat !== previous.drawingStat) return true
  for (const cardPath of previous.cardPaths) {
    const currentCardStat = await statToken(cardPath)
    if (currentCardStat !== previous.cardStats.get(cardPath)) return true
  }
  return false
}

export const clearLinkedDrawingFingerprints = () => fingerprints.clear()

export async function renderLinkedDrawingPreview(path: string): Promise<string> {
  const { renderDrawingPreviewWithScene } = await import('./drawingScene')
  const { dataUrl, scene } = await renderDrawingPreviewWithScene(path)
  await recordLinkedDrawingFingerprint(path, scene)
  return dataUrl
}

function preview(path: string): Promise<string> {
  const loading = pending.get(path)
  if (loading) return loading
  const request = renderLinkedDrawingPreview(path).finally(() => {
    if (pending.get(path) === request) pending.delete(path)
  })
  pending.set(path, request)
  return request
}

export const invalidateDrawingPreviews = () => pending.clear()
export const invalidateDrawingPreview = (path: string) => {
  pending.delete(path)
}

export function linkedDrawingPaths(markdown: string, documentPath?: string | null): string[] {
  if (!/\.excalidraw/i.test(markdown)) return []
  const resolved = new Set<string>()
  for (const image of findDocumentImages(markdown)) {
    const path = resolveDrawingPath(image.src, documentPath)
    if (path) resolved.add(path)
  }
  return [...resolved]
}

export async function renderEmbeddedDrawingPreview(source: string): Promise<string> {
  const { parseDrawing, renderDrawingScene } = await import('./drawingScene')
  return renderDrawingScene(await parseDrawing(source))
}

export function resolveDrawingPreview(src: string, documentPath?: string | null) {
  if (isInlineDrawingSource(src)) {
    return {
      key: src,
      load: async() => {
        const source = decodeInlineDrawing(src)
        if (source === undefined) throw new Error('Invalid inline drawing')
        return renderEmbeddedDrawingPreview(source)
      }
    }
  }
  const path = resolveDrawingPath(src, documentPath)
  if (path) return { key: path, load: () => preview(path) }
}

export async function expandDrawingPreviews(markdown: string, documentPath?: string | null): Promise<string> {
  if (!/excalidraw/i.test(markdown)) return markdown
  const converted = new Map<string, string>()
  const sources = new Set(findDocumentImages(markdown).map(image => image.src))
  await Promise.all([...sources].map(async src => {
    const drawing = resolveDrawingPreview(src, documentPath)
    if (!drawing) return
    try {
      converted.set(src, await drawing.load())
    } catch {
      // Keeping the original reference preserves its alt text if the drawing becomes unavailable.
    }
  }))
  return applyMarkdownEdits(markdown, imageDestinationEdits(markdown, converted))
}
