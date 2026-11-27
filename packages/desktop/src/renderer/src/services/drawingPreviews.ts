import { decodeInlineDrawing, drawingPreviewExpansionEdits, findDocumentImages, isInlineDrawingSource } from '@muyajs/core'
import { applyMarkdownEdits } from '@shared/markdownEdits'
import { resolveDrawingPath } from '@/util/drawingPaths'
import { DrawingPreviewQueue, type DrawingPreviewPriority } from './drawingPreviewQueue'
import type { DrawingScene } from './drawingScene'

interface LinkedDrawingFingerprint {
  drawingStat: string
  cardPaths: string[]
  cardStats: Map<string, string>
}

const queue = new DrawingPreviewQueue()
const linkedKeys = new Map<string, object>()
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

export function renderLinkedDrawingPreview(
  path: string,
  priority: DrawingPreviewPriority = 'viewport',
  signal?: AbortSignal
): Promise<string> {
  const key = linkedKeys.get(path) ?? {}
  linkedKeys.set(path, key)
  return queue.schedule(key, priority, async() => {
    const { renderDrawingPreviewWithScene } = await import('./drawingScene')
    const { dataUrl, scene } = await renderDrawingPreviewWithScene(path)
    if (linkedKeys.get(path) === key)
      await recordLinkedDrawingFingerprint(path, scene)
    return dataUrl
  }, signal)
}

export function renderSavedDrawingScene(scene: DrawingScene): Promise<string> {
  return queue.schedule(scene, 'viewport', async() => {
    const { renderDrawingScene } = await import('./drawingScene')
    return renderDrawingScene(scene)
  })
}

export const invalidateDrawingPreviews = () => linkedKeys.clear()
export const invalidateDrawingPreview = (path: string) => {
  linkedKeys.delete(path)
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

const MAX_EMBEDDED_DRAWING_CACHE = 32
const embeddedDrawingCache = new Map<string, string>()
export async function renderEmbeddedDrawingPreview(
  source: string,
  signal?: AbortSignal,
  priority: DrawingPreviewPriority = 'viewport'
): Promise<string> {
  const cached = embeddedDrawingCache.get(source)
  if (cached !== undefined) {
    embeddedDrawingCache.delete(source)
    embeddedDrawingCache.set(source, cached)
    return cached
  }
  return queue.schedule(source, priority, async() => {
    const { parseDrawing, renderDrawingScene } = await import('./drawingScene')
    const dataUrl = await renderDrawingScene(await parseDrawing(source))
    if (embeddedDrawingCache.size >= MAX_EMBEDDED_DRAWING_CACHE) {
      const oldest = embeddedDrawingCache.keys().next().value
      if (oldest !== undefined) embeddedDrawingCache.delete(oldest)
    }
    embeddedDrawingCache.set(source, dataUrl)
    return dataUrl
  }, signal)
}

export function resolveDrawingPreview(src: string, documentPath?: string | null, priority: DrawingPreviewPriority = 'viewport') {
  if (isInlineDrawingSource(src)) {
    return {
      key: src,
      load: async(signal?: AbortSignal) => {
        const source = decodeInlineDrawing(src)
        if (source === undefined) throw new Error('Invalid inline drawing')
        return renderEmbeddedDrawingPreview(source, signal, priority)
      }
    }
  }
  const path = resolveDrawingPath(src, documentPath)
  if (path) return { key: path, load: (signal?: AbortSignal) => renderLinkedDrawingPreview(path, priority, signal) }
}

export async function expandDrawingPreviews(markdown: string, documentPath?: string | null): Promise<string> {
  if (!/excalidraw/i.test(markdown)) return markdown
  const converted = new Map<string, string>()
  const sources = new Set(findDocumentImages(markdown).map(image => image.src))
  await Promise.all([...sources].map(async src => {
    const drawing = resolveDrawingPreview(src, documentPath, 'export')
    if (!drawing) return
    try {
      converted.set(src, await drawing.load())
    } catch {
      // Keeping the original reference preserves its alt text if the drawing becomes unavailable.
    }
  }))
  return applyMarkdownEdits(markdown, drawingPreviewExpansionEdits(markdown, converted))
}
