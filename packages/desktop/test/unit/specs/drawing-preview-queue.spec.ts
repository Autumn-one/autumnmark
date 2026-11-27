import { expect, it, vi } from 'vitest'
import { DrawingPreviewQueue } from '@/services/drawingPreviewQueue'

it('shares a pending job and gives a visible page priority over export and parked work', async() => {
  const queue = new DrawingPreviewQueue()
  const oldPage = new AbortController()
  const order: string[] = []
  const run = (key: string) => async() => {
    order.push(key)
    return key
  }
  const parked = queue.schedule('parked', 'viewport', run('parked'), oldPage.signal)
  const shared = queue.schedule('shared', 'export', run('shared'))
  const explicit = queue.schedule('explicit', 'export', run('explicit'))
  oldPage.abort()
  expect(queue.schedule('shared', 'viewport', run('duplicate'))).toBe(shared)
  await Promise.all([parked, shared, explicit])
  expect(order).toEqual(['shared', 'explicit', 'parked'])
})

it('reports a timeout without starting another canvas export until the first returns', async() => {
  vi.useFakeTimers()
  try {
    const queue = new DrawingPreviewQueue()
    let finish!: (url: string) => void
    const first = queue.schedule('first', 'viewport', () => new Promise(resolve => { finish = resolve }))
    const timedOut = expect(first).rejects.toThrow('timed out')
    const next = vi.fn(async() => 'next')
    const second = queue.schedule('second', 'viewport', next)
    await vi.advanceTimersByTimeAsync(30_001)
    await timedOut
    expect(next).not.toHaveBeenCalled()
    finish('late')
    await expect(second).resolves.toBe('next')
  } finally {
    vi.useRealTimers()
  }
})

it('settles a queued consumer when a hung export keeps the canvas slot occupied', async() => {
  vi.useFakeTimers()
  try {
    const queue = new DrawingPreviewQueue()
    const hung = queue.schedule('hung', 'viewport', () => new Promise(() => {}))
    const waiting = queue.schedule('waiting', 'viewport', async() => 'unused')
    const hungTimeout = expect(hung).rejects.toThrow('timed out')
    const queueTimeout = expect(waiting).rejects.toThrow('timed out in queue')
    await vi.advanceTimersByTimeAsync(60_001)
    await Promise.all([hungTimeout, queueTimeout])
  } finally {
    vi.useRealTimers()
  }
})
