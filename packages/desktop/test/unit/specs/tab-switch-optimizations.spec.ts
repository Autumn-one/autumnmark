import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IFileState } from '@shared/types/files'
import {
  cancelTabHover,
  notifyTabHover,
  setTabDragging,
  TabPrewarmScheduler
} from '@/services/tabPrewarm'

function makeTab(id: string, markdown: string, pathname = `/notes/${id}.md`): IFileState {
  return {
    id,
    filename: `${id}.md`,
    pathname,
    markdown,
    readOnly: false
  } as IFileState
}

describe('TabPrewarmScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setTabDragging(false)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    setTabDragging(false)
    cancelTabHover()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('prewarms adjacent tabs (active +/- 1) after double-rAF + quiet window and skips drawing tabs', async() => {
    const retained = new Set<string>(['t2'])
    const prewarmed: string[] = []
    const fakeMuya = {
      hasRetainedDocument: (id: string) => retained.has(id),
      prewarmDocument: (opts: { id: string }) => {
        retained.add(opts.id)
        prewarmed.push(opts.id)
        return true
      }
    }

    const tabs = [
      makeTab('t1', '# One'),
      makeTab('t2', '# Two'),
      makeTab('t3', '# Three', '/notes/diagram.excalidraw'),
      makeTab('t4', '# Four')
    ]

    const scheduler = new TabPrewarmScheduler({
      getMuya: () => fakeMuya as never,
      getTabs: () => tabs,
      getActiveTabId: () => 't2',
      isSuspended: () => false,
      isSourceMode: () => false,
      isPoolEnabled: () => true,
      contextFor: (tab) => ({ id: tab.id, pathname: tab.pathname }),
      onEvict: vi.fn()
    })

    scheduler.scheduleAfterPaint()
    await vi.advanceTimersByTimeAsync(1500)

    // t3 is a drawing tab so it is skipped; t4 is outside +/-1; t1 is prewarmed.
    expect(prewarmed).toEqual(['t1'])
    scheduler.dispose()
  })

  function startupFixture(slices = 1) {
    const callbacks = new Map<number, IdleRequestCallback>()
    const options: Array<IdleRequestOptions | undefined> = []
    let nextHandle = 0
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback, requestOptions?: IdleRequestOptions) => {
      const id = ++nextHandle
      callbacks.set(id, callback)
      options.push(requestOptions)
      return id
    })
    vi.stubGlobal('cancelIdleCallback', (id: number) => { callbacks.delete(id) })
    const retained = new Set(['active'])
    const prewarmDocument = vi.fn(({ id }: { id: string }) => {
      retained.add(id)
      return true
    })
    const cancel = vi.fn()
    const createIdleDocumentPrewarm = (options: { id: string }) => {
      let remaining = slices
      return {
        advance: () => {
          remaining--
          if (remaining > 0) return false
          return prewarmDocument(options)
        },
        cancel
      }
    }
    const tabs = [makeTab('left', '# Left'), makeTab('active', '# Active'), makeTab('right', '# Right')]
    const scheduler = new TabPrewarmScheduler({
      getMuya: () => ({ hasRetainedDocument: (id: string) => retained.has(id), prewarmDocument, createIdleDocumentPrewarm }) as never,
      getTabs: () => tabs,
      getActiveTabId: () => 'active',
      isSuspended: () => false,
      isSourceMode: () => false,
      isPoolEnabled: () => true,
      contextFor: (tab) => ({ id: tab.id, pathname: tab.pathname }),
      onEvict: vi.fn()
    })
    const runIdle = (timeRemaining: number) => {
      const first = callbacks.entries().next().value
      if (!first) throw new Error('Expected a requested idle callback')
      const [id, callback] = first
      callbacks.delete(id)
      callback({ didTimeout: false, timeRemaining: () => timeRemaining })
    }
    return { callbacks, options, prewarmDocument, runIdle, scheduler, cancel }
  }

  it('uses the first suitable startup idle period for one adjacent tab', async() => {
    const fixture = startupFixture()
    try {
      fixture.scheduler.scheduleAfterPaint({ startup: true })
      await vi.advanceTimersByTimeAsync(31)
      expect(fixture.callbacks.size).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(fixture.options).toEqual([undefined])
      fixture.runIdle(45)
      expect(fixture.prewarmDocument.mock.calls.map(([tab]) => tab.id)).toEqual(['right'])
      expect(fixture.callbacks.size).toBe(0)
    } finally {
      fixture.scheduler.dispose()
    }
  })

  it('leaves startup idle time available for input when the build will not fit', async() => {
    const fixture = startupFixture()
    try {
      fixture.scheduler.scheduleAfterPaint({ startup: true })
      await vi.advanceTimersByTimeAsync(32)
      fixture.runIdle(1)
      expect(fixture.prewarmDocument).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(fixture.options.at(-1)).toEqual({ timeout: 1000 })
      fixture.runIdle(45)
      await Promise.resolve()
      expect(fixture.prewarmDocument).toHaveBeenCalledOnce()
    } finally {
      fixture.scheduler.dispose()
    }
  })

  it('cancels the startup idle pass as soon as the user interacts', async() => {
    const fixture = startupFixture()
    try {
      fixture.scheduler.scheduleAfterPaint({ startup: true })
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.callbacks.size).toBe(1)
      document.dispatchEvent(new Event('pointerdown'))
      expect(fixture.callbacks.size).toBe(0)
      expect(fixture.prewarmDocument).not.toHaveBeenCalled()
    } finally {
      fixture.scheduler.dispose()
    }
  })

  it('drops a partially built startup page when input arrives between slices', async() => {
    const fixture = startupFixture(2)
    try {
      fixture.scheduler.scheduleAfterPaint({ startup: true })
      await vi.advanceTimersByTimeAsync(32)
      fixture.runIdle(7)
      expect(fixture.prewarmDocument).not.toHaveBeenCalled()
      document.dispatchEvent(new Event('pointerdown'))
      expect(fixture.cancel).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.callbacks.size).toBe(0)
    } finally {
      fixture.scheduler.dispose()
    }
  })

  it('holds a partial page for the exact tab receiving the pointer press', async() => {
    const fixture = startupFixture(2)
    const tabs = document.createElement('div')
    tabs.className = 'editor-tabs'
    const target = document.createElement('li')
    target.dataset.id = 'right'
    tabs.append(target)
    document.body.append(tabs)
    try {
      fixture.scheduler.scheduleAfterPaint({ startup: true })
      await vi.advanceTimersByTimeAsync(32)
      fixture.runIdle(7)
      target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.cancel).not.toHaveBeenCalled()
      expect(fixture.callbacks.size).toBe(0)
    } finally {
      tabs.remove()
      fixture.scheduler.dispose()
    }
  })

  it('prioritizes a hovered tab after 50ms debounce and suppresses prewarm while dragging', async() => {
    const retained = new Set<string>(['t1'])
    const prewarmed: string[] = []
    const fakeMuya = {
      hasRetainedDocument: (id: string) => retained.has(id),
      prewarmDocument: (opts: { id: string }) => {
        retained.add(opts.id)
        prewarmed.push(opts.id)
        return true
      }
    }

    const tabs = [
      makeTab('t1', '# One'),
      makeTab('t2', '# Two'),
      makeTab('t3', '# Three'),
      makeTab('t4', '# Four')
    ]

    const scheduler = new TabPrewarmScheduler({
      getMuya: () => fakeMuya as never,
      getTabs: () => tabs,
      getActiveTabId: () => 't1',
      isSuspended: () => false,
      isSourceMode: () => false,
      isPoolEnabled: () => true,
      contextFor: (tab) => ({ id: tab.id, pathname: tab.pathname }),
      onEvict: vi.fn()
    })

    setTabDragging(true)
    notifyTabHover('t4')
    await vi.advanceTimersByTimeAsync(200)
    expect(prewarmed).toEqual([])

    setTabDragging(false)
    notifyTabHover('t4')
    await vi.advanceTimersByTimeAsync(200)
    expect(prewarmed[0]).toBe('t4')
    scheduler.dispose()
  })

  it('aborts pending idle work when user interaction occurs', async() => {
    const retained = new Set<string>(['t1'])
    const prewarmed: string[] = []
    const fakeMuya = {
      hasRetainedDocument: (id: string) => retained.has(id),
      prewarmDocument: (opts: { id: string }) => {
        retained.add(opts.id)
        prewarmed.push(opts.id)
        return true
      }
    }
    const tabs = [makeTab('t1', '# One'), makeTab('t2', '# Two')]

    const scheduler = new TabPrewarmScheduler({
      getMuya: () => fakeMuya as never,
      getTabs: () => tabs,
      getActiveTabId: () => 't1',
      isSuspended: () => false,
      isSourceMode: () => false,
      isPoolEnabled: () => true,
      contextFor: (tab) => ({ id: tab.id, pathname: tab.pathname }),
      onEvict: vi.fn()
    })

    scheduler.scheduleAfterPaint()
    await vi.advanceTimersByTimeAsync(200)
    document.dispatchEvent(new Event('keydown'))
    await vi.advanceTimersByTimeAsync(150)
    expect(prewarmed).toEqual([])

    await vi.advanceTimersByTimeAsync(400)
    expect(prewarmed).toEqual(['t2'])
    scheduler.dispose()
  })
})
