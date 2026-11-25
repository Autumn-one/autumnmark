import { expect, it, vi } from 'vitest'
import { deferThemeDevUpdates } from '../../../src/renderer/src/prefComponents/theme/devUpdates'

it('holds both Vite clients until the studio has committed the chat turn', async() => {
  const main = { on: vi.fn(), off: vi.fn() }
  const frame = { on: vi.fn(), off: vi.fn() }
  let finish = () => {}
  const writing = new Promise<void>(resolve => { finish = resolve })
  const releaseMain = deferThemeDevUpdates(main as unknown as NonNullable<ImportMeta['hot']>, () => writing)
  const releaseFrame = deferThemeDevUpdates(frame as unknown as NonNullable<ImportMeta['hot']>)
  try {
    const waits: Promise<void>[] = []
    for (const client of [main, frame]) {
      expect(client.on.mock.calls.map(([name]) => name)).toEqual(['vite:beforeFullReload', 'vite:beforeUpdate'])
      for (const [, listener] of client.on.mock.calls) waits.push(listener())
    }
    const reloaded = vi.fn()
    const update = Promise.all(waits).then(reloaded)
    await Promise.resolve()
    expect(reloaded).not.toHaveBeenCalled()
    finish()
    await update
    expect(reloaded).toHaveBeenCalledOnce()
  } finally {
    releaseFrame()
    releaseMain()
  }
  expect(main.off.mock.calls).toEqual(main.on.mock.calls)
  expect(frame.off.mock.calls).toEqual(frame.on.mock.calls)
})
