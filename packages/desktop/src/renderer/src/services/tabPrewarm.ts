import {
  loadedPrismLanguages,
  loadPrismLanguage,
  type IDocumentContext,
  type IIdleDocumentPrewarm,
  type IPrewarmDocumentOptions,
  type ISerializedHistory,
  type Muya
} from '@muyajs/core'
import type { IFileState } from '@shared/types/files'
import { isDrawingPath } from '@/util/drawingPaths'
import { markTabPrewarmed } from './tabSwitchPerf'

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

function scanNextTargetLanguages(markdown: string): Set<string> {
  const prismLangs = new Set<string>()
  FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    const lang = match[1]?.trim().toLowerCase() ?? ''
    if (!lang) continue
    if (!DIAGRAM_FENCE_TYPES.has(lang) && lang !== 'excalidraw' && !loadedPrismLanguages.has(lang)) {
      prismLangs.add(lang)
    }
  }
  return prismLangs
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
 * Prewarms adjacent or hovered tabs. Diagram chunks need a visible preview consumer.
 */
export class TabPrewarmScheduler {
  private _interactionEpoch = 0
  private _quietTimer: ReturnType<typeof setTimeout> | null = null
  private _startupIdleHandle: number | null = null
  private _startupGeneration = 0
  private _startupPrewarm: { id: string; task: IIdleDocumentPrewarm } | null = null
  private _idleHandle: number | null = null
  private _idleFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private _inFlightId: string | null = null
  private _prioritizedHoverId: string | null = null
  private _attemptedContent = new Map<string, string>()
  private _disposed = false
  private readonly _onInteract: (event: Event) => void

  constructor(private readonly _host: TabPrewarmHost) {
    this._onInteract = (event) => {
      this._interactionEpoch++
      const tab = event.type === 'pointerdown' && event.target instanceof Element
        ? event.target.closest<HTMLElement>('.editor-tabs li[data-id]')
        : null
      this._cancelScheduled(!!tab && tab.dataset.id === this._startupPrewarm?.id)
      this.scheduleAfterQuiet()
    }
    for (const eventName of ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const) {
      document.addEventListener(eventName, this._onInteract, { capture: true, passive: true })
    }
    hoverHandler = (tabId: string) => this.prioritizeHover(tabId)
  }

  scheduleAfterPaint({ startup = false } = {}): void {
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
        if (startup) this._scheduleStartupPrewarm(epoch)
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
      this._cancelStartupIdle()
      this._enqueueIdleRun()
    }, IDLE_QUIET_WINDOW_MS)
  }

  prioritizeHover(tabId: string): void {
    if (this._disposed || isTabDragging) return
    if (this._host.isSuspended() || this._host.isSourceMode() || !this._host.isPoolEnabled()) return
    if (tabId === this._host.getActiveTabId()) return
    if (this._startupPrewarm?.id === tabId) return
    this._cancelStartupIdle()
    this._prioritizedHoverId = tabId
    this._enqueueIdleRun()
  }

  private _cancelScheduled(keepForActivation = false): void {
    this._cancelStartupIdle(keepForActivation)
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

  private _cancelStartupIdle(keepForActivation = false): void {
    this._startupGeneration++
    if (this._startupIdleHandle !== null) {
      cancelIdleCallback(this._startupIdleHandle)
      this._startupIdleHandle = null
    }
    if (!keepForActivation) {
      this._startupPrewarm?.task.cancel()
      this._startupPrewarm = null
    }
  }

  private _scheduleStartupPrewarm(epoch: number): void {
    const generation = this._startupGeneration
    this._requestStartupIdle(epoch, generation, deadline => {
      const tab = this._pickNextCandidate()
      if (!tab || tab.markdown.length > 30_000) return
      const options = {
        id: tab.id,
        markdown: tab.markdown,
        context: this._host.contextFor(tab),
        readOnly: !!tab.readOnly,
        onEvict: this._host.onEvict
      }
      const step = this._startupStep(options, epoch, generation)
      const languages = scanNextTargetLanguages(tab.markdown)
      if (!languages.size) {
        step(deadline)
        return
      }

      void this._loadLanguages(tab.id, languages, epoch).then(() => {
        if (this._prioritizedHoverId && this._interactionEpoch === epoch) {
          this._enqueueIdleRun()
          return
        }
        this._requestStartupIdle(epoch, generation, step)
      })
    })
  }

  private _startupStep(options: IPrewarmDocumentOptions, epoch: number, generation: number): IdleRequestCallback {
    const { id, markdown, context } = options
    const step: IdleRequestCallback = deadline => {
      const current = this._host.getTabs().find(tab => tab.id === id)
      const muya = this._host.getMuya()
      if (!current || !muya || !this._canPrewarm(id, epoch) || current.markdown !== markdown ||
        !!current.readOnly !== options.readOnly || (current.pathname || undefined) !== context.pathname) {
        this._cancelStartupIdle()
        return
      }
      if (deadline.timeRemaining() >= 2) {
        if (!this._startupPrewarm) {
          const task = muya.createIdleDocumentPrewarm(options)
          if (!task) return
          this._startupPrewarm = { id, task }
        }
        const finished = this._startupPrewarm.task.advance(() => deadline.timeRemaining())
        if (finished) {
          this._startupPrewarm = null
          if (muya.hasRetainedDocument(id, markdown, context.pathname, context.dirname)) markTabPrewarmed(id)
          return
        }
      }
      // Request the next slice after rendering, even when the current idle period is too short.
      requestAnimationFrame(() => this._requestStartupIdle(epoch, generation, step))
    }
    return step
  }

  private _requestStartupIdle(epoch: number, generation: number, run: IdleRequestCallback): void {
    if (typeof requestIdleCallback !== 'function' || typeof cancelIdleCallback !== 'function') return
    if (this._disposed || this._interactionEpoch !== epoch || this._startupGeneration !== generation || this._quietTimer === null) return
    this._startupIdleHandle = requestIdleCallback(deadline => {
      this._startupIdleHandle = null
      if (this._inFlightId !== null || this._disposed || this._interactionEpoch !== epoch || isTabDragging) return
      try {
        run(deadline)
      } catch {
        // The ordinary scheduler can retry after a speculative build has been discarded.
        this._cancelStartupIdle()
      }
    })
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
      const context = this._host.contextFor(tab)
      if (muya.hasRetainedDocument(tab.id, tab.markdown, context.pathname, context.dirname)) continue
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
    const { id, markdown } = target
    await this._loadLanguages(id, scanNextTargetLanguages(markdown), epoch)
    if (!this._canPrewarm(id, epoch)) return
    this._prewarmTab(id, markdown, epoch)
    this._enqueueIdleRun()
  }

  private _canPrewarm(id: string, epoch: number): boolean {
    return !this._disposed && this._interactionEpoch === epoch && !isTabDragging
      && !this._host.isSuspended() && !this._host.isSourceMode() && this._host.isPoolEnabled()
      && this._host.getActiveTabId() !== id
  }

  private async _loadLanguages(id: string, languages: Set<string>, epoch: number): Promise<void> {
    this._inFlightId = id
    try {
      for (const lang of languages) {
        if (!this._canPrewarm(id, epoch)) return
        await loadPrismLanguage(lang).catch(() => {})
      }
    } finally {
      this._inFlightId = null
    }
  }

  private _prewarmTab(id: string, markdown: string, epoch: number): void {
    if (!this._canPrewarm(id, epoch)) return
    const liveTab = this._host.getTabs().find(tab => tab.id === id)
    const muya = this._host.getMuya()
    if (!liveTab || !muya || liveTab.markdown !== markdown) return
    const context = this._host.contextFor(liveTab)
    const retained = () => muya.hasRetainedDocument(id, markdown, context.pathname, context.dirname)
    if (retained()) return

    const didPrewarm = muya.prewarmDocument({
      id,
      markdown,
      context,
      readOnly: !!liveTab.readOnly,
      onEvict: this._host.onEvict
    })
    if (didPrewarm) {
      if (retained()) {
        markTabPrewarmed(id)
      } else {
        // Oversized docs stay state-only in the pool.
        this._attemptedContent.set(id, markdown)
      }
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
