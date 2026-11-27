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
