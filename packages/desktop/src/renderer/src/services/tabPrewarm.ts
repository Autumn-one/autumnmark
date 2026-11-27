import {
  loadDiagramRenderer,
  loadedPrismLanguages,
  loadPrismLanguage,
  type IDocumentContext,
  type ISerializedHistory,
  type Muya
} from '@muyajs/core'
import type { IFileState } from '@shared/types/files'
import { isDrawingPath } from '@/util/drawingPaths'

const IDLE_QUIET_WINDOW_MS = 300
const HOVER_DEBOUNCE_MS = 50
const DIAGRAM_FENCE_TYPES = new Set(['mermaid', 'vega-lite', 'flowchart', 'sequence', 'plantuml'])
const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~{]+)/gm

let isTabDragging = false
let hoverHandler: ((tabId: string) => void) | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null

export const setTabDragging = (dragging: boolean): void => {
  isTabDragging = dragging
  if (dragging && hoverTimer !== null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

export const notifyTabHover = (tabId: string): void => {
  if (isTabDragging || !hoverHandler) return
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    if (!isTabDragging) hoverHandler?.(tabId)
  }, HOVER_DEBOUNCE_MS)
}

export const cancelTabHover = (): void => {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

function scanNextTargetResources(markdown: string): { prismLangs: string[]; diagrams: string[] } {
  const prismLangs = new Set<string>()
  const diagrams = new Set<string>()
  FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    const lang = match[1]?.trim().toLowerCase() ?? ''
    if (!lang) continue
    if (DIAGRAM_FENCE_TYPES.has(lang)) {
      diagrams.add(lang)
    } else if (lang !== 'excalidraw' && !loadedPrismLanguages.has(lang)) {
      prismLangs.add(lang)
    }
  }
  return { prismLangs: [...prismLangs], diagrams: [...diagrams] }
}

export interface TabPrewarmHost {
  getMuya: () => Muya | null
  getTabs: () => readonly IFileState[]
  getActiveTabId: () => string | null
  isSuspended: () => boolean
  isSourceMode: () => boolean
  isPoolEnabled: () => boolean
  contextFor: (tab: IFileState) => IDocumentContext
  onEvict: (id: string, history: ISerializedHistory) => void
}

/**
 * Interruptible single-flight idle & hover pre-warmer for inactive Markdown tabs.
 * Prewarms at most adjacent tabs (active +/- 1) plus one hovered tab, loading Prism/diagram
 * chunks only for the next DOM-prewarm target and yielding immediately on user input.
 */
export class TabPrewarmScheduler {
  private _interactionEpoch = 0
  private _quietTimer: ReturnType<typeof setTimeout> | null = null
  private _idleHandle: number | null = null
  private _idleFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private _inFlightId: string | null = null
  private _prioritizedHoverId: string | null = null
  private _attemptedContent = new Map<string, string>()
  private _disposed = false
  private readonly _onInteract: () => void

  constructor(private readonly _host: TabPrewarmHost) {
    this._onInteract = () => {
      this._interactionEpoch++
      this._cancelScheduled()
      this.scheduleAfterQuiet()
    }
    for (const eventName of ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const) {
      document.addEventListener(eventName, this._onInteract, { capture: true, passive: true })
    }
    hoverHandler = (tabId: string) => this.prioritizeHover(tabId)
  }

  scheduleAfterPaint(): void {
    if (this._disposed) return
    this._cancelScheduled()
    if (typeof requestAnimationFrame !== 'function') {
      this.scheduleAfterQuiet()
      return
    }
    const epoch = this._interactionEpoch
    requestAnimationFrame(() => {
      if (this._disposed || this._interactionEpoch !== epoch) return
      requestAnimationFrame(() => {
        if (this._disposed || this._interactionEpoch !== epoch) return
        this.scheduleAfterQuiet()
      })
    })
  }

  scheduleAfterQuiet(): void {
    if (this._disposed) return
    if (this._quietTimer !== null) clearTimeout(this._quietTimer)
    const epoch = this._interactionEpoch
    this._quietTimer = setTimeout(() => {
      this._quietTimer = null
      if (this._disposed || this._interactionEpoch !== epoch) return
      this._enqueueIdleRun()
    }, IDLE_QUIET_WINDOW_MS)
  }

  prioritizeHover(tabId: string): void {
    if (this._disposed || isTabDragging) return
    if (this._host.isSuspended() || this._host.isSourceMode() || !this._host.isPoolEnabled()) return
    if (tabId === this._host.getActiveTabId()) return
    this._prioritizedHoverId = tabId
    this._enqueueIdleRun()
  }

  private _cancelScheduled(): void {
    if (this._quietTimer !== null) {
      clearTimeout(this._quietTimer)
      this._quietTimer = null
    }
    if (this._idleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this._idleHandle)
      this._idleHandle = null
    }
    if (this._idleFallbackTimer !== null) {
      clearTimeout(this._idleFallbackTimer)
      this._idleFallbackTimer = null
    }
  }

  private _enqueueIdleRun(): void {
    if (this._disposed || this._inFlightId !== null) return
    if (this._idleHandle !== null || this._idleFallbackTimer !== null) return
    const run = () => {
      this._idleHandle = null
      this._idleFallbackTimer = null
      void this._runNext()
    }
    if (typeof requestIdleCallback === 'function') {
      this._idleHandle = requestIdleCallback(run, { timeout: 1000 })
    } else {
      this._idleFallbackTimer = setTimeout(run, 16)
    }
  }

  private _pickNextCandidate(): IFileState | null {
    const muya = this._host.getMuya()
    if (!muya || this._host.isSuspended() || this._host.isSourceMode() || !this._host.isPoolEnabled()) {
      return null
    }
    const tabs = this._host.getTabs()
    const activeId = this._host.getActiveTabId()
    const activeIndex = tabs.findIndex(tab => tab.id === activeId)
    const candidates: IFileState[] = []

    if (this._prioritizedHoverId) {
      const hovered = tabs.find(tab => tab.id === this._prioritizedHoverId)
      this._prioritizedHoverId = null
      if (hovered) candidates.push(hovered)
    }
    if (activeIndex >= 0) {
      const nextTab = tabs[activeIndex + 1]
      if (nextTab) candidates.push(nextTab)
      const prevTab = tabs[activeIndex - 1]
      if (prevTab) candidates.push(prevTab)
    }

    for (const tab of candidates) {
      if (tab.id === activeId) continue
      if (isDrawingPath(tab.pathname || tab.filename)) continue
      if (typeof tab.markdown !== 'string') continue
      if (muya.hasRetainedDocument(tab.id, tab.markdown, tab.pathname)) continue
      if (this._attemptedContent.get(tab.id) === tab.markdown) continue
      return tab
    }
    return null
  }

  private async _runNext(): Promise<void> {
    if (this._disposed || isTabDragging || this._inFlightId !== null) return
    const target = this._pickNextCandidate()
    if (!target) return

    const epoch = this._interactionEpoch
    const targetId = target.id
    const markdown = target.markdown
    this._inFlightId = targetId

    try {
      // Load Prism/diagram chunks only for this specific next DOM-prewarm target.
      const { prismLangs, diagrams } = scanNextTargetResources(markdown)
      for (const lang of prismLangs) {
        if (this._disposed || this._interactionEpoch !== epoch || isTabDragging) return
        if (this._host.getActiveTabId() === targetId) return
        await loadPrismLanguage(lang).catch(() => {})
      }
      for (const diagramType of diagrams) {
        if (this._disposed || this._interactionEpoch !== epoch || isTabDragging) return
        if (this._host.getActiveTabId() === targetId) return
        await loadDiagramRenderer(diagramType).catch(() => {})
      }

      if (this._disposed || this._interactionEpoch !== epoch || isTabDragging) return
      if (this._host.isSuspended() || this._host.isSourceMode() || !this._host.isPoolEnabled()) return
      if (this._host.getActiveTabId() === targetId) return

      const liveTab = this._host.getTabs().find(tab => tab.id === targetId)
      const muya = this._host.getMuya()
      if (!liveTab || !muya || liveTab.markdown !== markdown) return
      if (muya.hasRetainedDocument(targetId, markdown, liveTab.pathname)) return

      const didPrewarm = muya.prewarmDocument({
        id: targetId,
        markdown,
        context: this._host.contextFor(liveTab),
        readOnly: !!liveTab.readOnly,
        onEvict: this._host.onEvict
      })
      if (didPrewarm && !muya.hasRetainedDocument(targetId, markdown, liveTab.pathname)) {
        // Oversized docs stay state-only in the pool; do not retry the same content repeatedly.
        this._attemptedContent.set(targetId, markdown)
      }
    } finally {
      if (this._inFlightId === targetId) this._inFlightId = null
    }

    if (!this._disposed && this._interactionEpoch === epoch && !isTabDragging) {
      this._enqueueIdleRun()
    }
  }

  dispose(): void {
    this._disposed = true
    this._cancelScheduled()
    cancelTabHover()
    hoverHandler = null
    for (const eventName of ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const) {
      document.removeEventListener(eventName, this._onInteract, true)
    }
  }
}
