/**
 * Dev-only tab-switch performance instrumentation using the User Timing API.
 * Production builds skip mark/measure recording and never emit user-facing logs.
 */

export interface TabSwitchSample {
  seq: number
  toId: string
  fromId: string | null
  chars: number
  blocks: number
  historyLength: number
  firstVisit: boolean
  mode: 'wysiwyg' | 'source' | 'drawing'
  hotHit: boolean
  crossedDrawing: boolean
  flushMs: number
  editorMs: number
  tocMs: number
  scrollMs: number
  syncTotalMs: number
  raf1Ms: number
  paintMs: number
  activationMs: Partial<Record<TabActivationStage, number>>
}

export type TabActivationStage = 'attach' | 'reading' | 'layout' | 'selection' | 'viewCapture'

interface ActiveTrace {
  seq: number
  toId: string
  fromId: string | null
  chars: number
  blocks: number
  historyLength: number
  firstVisit: boolean
  mode: 'wysiwyg' | 'source' | 'drawing'
  hotHit: boolean
  crossedDrawing: boolean
  t0: number
  tFlush: number
  tEditor: number
  tToc: number
  tScroll: number
  tSyncEnd: number
  activationMs: Partial<Record<TabActivationStage, number>>
}

const MAX_SAMPLES = 100
const visitedTabIds = new Set<string>()
const samples: TabSwitchSample[] = []
let seqCounter = 0
let active: ActiveTrace | null = null

const isPerfEnabled = (): boolean => {
  if (typeof performance === 'undefined') return false
  if ((globalThis as { __AUTUMNMARK_TAB_PERF__?: boolean }).__AUTUMNMARK_TAB_PERF__) return true
  if (typeof window !== 'undefined' && window.marktext?.env?.debug) return true
  return Boolean(import.meta.env?.DEV)
}

const safeMark = (name: string): void => {
  try {
    performance.mark(name)
  } catch {
    // Ignore unsupported User Timing environments.
  }
}

const safeMeasure = (name: string, start: string, end: string): void => {
  try {
    performance.measure(name, start, end)
  } catch {
    // Ignore missing marks when a newer switch preempted an older trace.
  }
}

export const startTabSwitchTrace = (meta: {
  toId: string
  fromId: string | null
  chars: number
  mode: 'wysiwyg' | 'source' | 'drawing'
  crossedDrawing: boolean
}): void => {
  const firstVisit = !visitedTabIds.has(meta.toId)
  visitedTabIds.add(meta.toId)
  if (!isPerfEnabled()) return

  const seq = ++seqCounter
  const now = performance.now()
  active = {
    seq,
    toId: meta.toId,
    fromId: meta.fromId,
    chars: meta.chars,
    blocks: 0,
    historyLength: 0,
    firstVisit,
    mode: meta.mode,
    hotHit: false,
    crossedDrawing: meta.crossedDrawing,
    t0: now,
    tFlush: now,
    tEditor: now,
    tToc: now,
    tScroll: now,
    tSyncEnd: now,
    activationMs: {}
  }
  safeMark(`mt:tab-switch:${seq}:start`)
}

export const getActivationTimer = () => {
  const trace = active
  if (!trace) return undefined
  return (stage: TabActivationStage, start: number) => {
    trace.activationMs[stage] = (trace.activationMs[stage] ?? 0) + performance.now() - start
  }
}

export const markTabPrewarmed = (id: string): void => {
  if (isPerfEnabled()) safeMark(`mt:tab-prewarm:${id}`)
}

export const markTabSwitchFlush = (): void => {
  if (!active) return
  active.tFlush = performance.now()
  safeMark(`mt:tab-switch:${active.seq}:flush`)
}

export const markTabSwitchEditor = (details?: {
  hotHit?: boolean
  blocks?: number
  historyLength?: number
}): void => {
  if (!active) return
  active.tEditor = performance.now()
  if (details?.hotHit !== undefined) active.hotHit = details.hotHit
  if (details?.blocks !== undefined) active.blocks = details.blocks
  if (details?.historyLength !== undefined) active.historyLength = details.historyLength
  safeMark(`mt:tab-switch:${active.seq}:editor`)
}

export const markTabSwitchToc = (): void => {
  if (!active) return
  active.tToc = performance.now()
  safeMark(`mt:tab-switch:${active.seq}:toc`)
}

export const markTabSwitchScroll = (): void => {
  if (!active) return
  active.tScroll = performance.now()
  safeMark(`mt:tab-switch:${active.seq}:scroll`)
}

export const finishTabSwitchSync = (): void => {
  const trace = active
  if (!trace) return
  trace.tSyncEnd = performance.now()
  safeMark(`mt:tab-switch:${trace.seq}:sync-end`)
  safeMeasure(
    `mt:tab-switch:${trace.seq}:sync`,
    `mt:tab-switch:${trace.seq}:start`,
    `mt:tab-switch:${trace.seq}:sync-end`
  )
  active = null

  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => {
    const tRaf1 = performance.now()
    safeMark(`mt:tab-switch:${trace.seq}:raf1`)
    requestAnimationFrame(() => {
      const tPaint = performance.now()
      safeMark(`mt:tab-switch:${trace.seq}:paint`)
      safeMeasure(
        `mt:tab-switch:${trace.seq}:total-to-paint`,
        `mt:tab-switch:${trace.seq}:start`,
        `mt:tab-switch:${trace.seq}:paint`
      )
      const sample: TabSwitchSample = {
        seq: trace.seq,
        toId: trace.toId,
        fromId: trace.fromId,
        chars: trace.chars,
        blocks: trace.blocks,
        historyLength: trace.historyLength,
        firstVisit: trace.firstVisit,
        mode: trace.mode,
        hotHit: trace.hotHit,
        crossedDrawing: trace.crossedDrawing,
        flushMs: Math.max(0, trace.tFlush - trace.t0),
        editorMs: Math.max(0, trace.tEditor - trace.tFlush),
        tocMs: Math.max(0, trace.tToc - trace.tEditor),
        scrollMs: Math.max(0, trace.tScroll - trace.tToc),
        syncTotalMs: Math.max(0, trace.tSyncEnd - trace.t0),
        raf1Ms: Math.max(0, tRaf1 - trace.t0),
        paintMs: Math.max(0, tPaint - trace.t0),
        activationMs: trace.activationMs
      }
      samples.push(sample)
      if (samples.length > MAX_SAMPLES) samples.shift()
      ;(globalThis as { __tabSwitchPerfSamples?: TabSwitchSample[] }).__tabSwitchPerfSamples = samples
    })
  })
}

export const forgetTabSwitchVisit = (id: string): void => {
  visitedTabIds.delete(id)
}

export const getTabSwitchPerfSamples = (): readonly TabSwitchSample[] => samples
