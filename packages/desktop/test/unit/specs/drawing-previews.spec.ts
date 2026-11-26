// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLinkedDrawingFingerprints,
  hasLinkedDrawingChanged,
  linkedDrawingPaths,
  recordLinkedDrawingFingerprint
} from '@/services/drawingPreviews'

const mockStat = vi.fn()

beforeEach(() => {
  clearLinkedDrawingFingerprints()
  mockStat.mockReset()
  Object.defineProperty(window, 'fileUtils', {
    configurable: true,
    value: {
      stat: mockStat,
      hasMarkdownExtension: (p: string) => /\.md$/i.test(p)
    }
  })
  Object.defineProperty(window, 'path', {
    configurable: true,
    value: {
      isAbsolute: (p: string) => p.startsWith('/'),
      dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) || '/',
      resolve: (base: string, rel: string) => rel.startsWith('/') ? rel : `${base.replace(/\/$/, '')}/${rel.replace(/^\.\//, '')}`
    }
  })
})

describe('linkedDrawingPaths', () => {
  it('ignores prose mentions of .excalidraw and returns deduplicated linked drawing paths', () => {
    expect(linkedDrawingPaths('We mention foo.excalidraw in prose only.\n', '/notes/doc.md')).toEqual([])

    const markdown = [
      '![First](./arch.excalidraw)',
      '![Second](arch.excalidraw)',
      '![Other](./sub/flow.excalidraw)',
      '![Regular](./photo.png)'
    ].join('\n\n')

    expect(linkedDrawingPaths(markdown, '/notes/doc.md')).toEqual([
      '/notes/arch.excalidraw',
      '/notes/sub/flow.excalidraw'
    ])
  })
})

describe('linked drawing fingerprint change detection', () => {
  it('always returns true when no fingerprint has been recorded yet', async() => {
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 42 })
    expect(await hasLinkedDrawingChanged('/notes/arch.excalidraw')).toBe(true)
  })

  it('short-circuits when drawing and referenced card stats are unchanged and triggers when either changes', async() => {
    const stats = new Map<string, { mtimeMs: number; size: number }>([
      ['/notes/arch.excalidraw', { mtimeMs: 1000, size: 512 }],
      ['/notes/spec.md', { mtimeMs: 2000, size: 120 }]
    ])
    mockStat.mockImplementation(async(p: string) => {
      const entry = stats.get(p)
      if (!entry) throw new Error('ENOENT')
      return entry
    })

    await recordLinkedDrawingFingerprint('/notes/arch.excalidraw', {
      elements: [{
        id: 'card-1',
        type: 'image',
        isDeleted: false,
        customData: { autumnmarkDocument: { path: 'spec.md' } }
      } as never],
      appState: {},
      files: {}
    })

    expect(await hasLinkedDrawingChanged('/notes/arch.excalidraw')).toBe(false)

    // Updating a referenced Markdown card invalidates the fingerprint.
    stats.set('/notes/spec.md', { mtimeMs: 2500, size: 128 })
    expect(await hasLinkedDrawingChanged('/notes/arch.excalidraw')).toBe(true)

    // Re-recording stabilizes it again, then modifying the drawing file triggers change.
    await recordLinkedDrawingFingerprint('/notes/arch.excalidraw', {
      elements: [{
        id: 'card-1',
        type: 'image',
        isDeleted: false,
        customData: { autumnmarkDocument: { path: 'spec.md' } }
      } as never],
      appState: {},
      files: {}
    })
    expect(await hasLinkedDrawingChanged('/notes/arch.excalidraw')).toBe(false)

    stats.set('/notes/arch.excalidraw', { mtimeMs: 1500, size: 600 })
    expect(await hasLinkedDrawingChanged('/notes/arch.excalidraw')).toBe(true)
  })
})
