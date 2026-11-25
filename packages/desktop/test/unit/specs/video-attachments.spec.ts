import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { VideoAttachments } from '@/util/videoAttachments'

const payload = 'A'.repeat(96 * 1024)
const first = 'data:video/mp4;base64,' + payload
const second = 'data:video/webm;charset=utf-8;base64,' + payload.replaceAll('A', 'B')
const video = (src: string) => '<video src="' + src + '"></video>'

describe('embedded video attachments', () => {
  it('round trips tag spelling, nested sources, repeated videos and unquoted attributes', () => {
    const videos = new VideoAttachments()
    const original = ['中文😀', video(first), '<VIDEO controls>\n<SOURCE src=' + second + '>\n</VIDEO>', video(first)].join('\n')
    const compact = videos.compact(original)
    expect(compact.length).toBeLessThan(300)
    expect(videos.compact(original)).toBe(compact)
    expect(videos.expand(compact) === original).toBe(true)
    expect(videos.expand(compact.replace('video/mp4', 'video/mpeg')) === original.replace('video/mp4', 'video/mpeg')).toBe(true)
  })

  it('preserves video data URLs used in links and unsupported markup', () => {
    const videos = new VideoAttachments()
    const original = '[download](' + first + ')\n' + video(first + '#t=2')
    expect(videos.compact(original) === original).toBe(true)
  })

  it('recognizes the same saved view after reopening with fresh attachment references', async() => {
    const crypto = vi.spyOn(window, 'crypto', 'get').mockReturnValue(webcrypto as unknown as Crypto)
    try {
      const before = new VideoAttachments()
      const after = new VideoAttachments()
      const previous = before.compact(video(first))
      const reopened = after.compact(video(first))
      expect(reopened).not.toBe(previous)
      expect(await after.viewKey(reopened)).toBe(await before.viewKey(previous))
      expect(await after.viewKey(after.compact(video(second)))).not.toBe(await before.viewKey(previous))
    } finally {
      crypto.mockRestore()
    }
  })

  it('exposes original sources to the video dialog and keeps deleted attachments available to undo', () => {
    const videos = new VideoAttachments()
    const ref = videos.compactSource(first)
    let current: string | null = ref
    const image = videos.edit({ kind: 'video', src: ref, name: '', readOnly: false,
      matches: expected => current === expected,
      apply: (value, expected) => { if (current === expected) current = value },
      undo: () => { current = ref }
    })
    expect(image.src === first).toBe(true)
    const replaceVideo = image.apply
    replaceVideo(second)
    expect(current?.length).toBeLessThan(100)
    expect(image.matches(second)).toBe(true)
    replaceVideo(null, second)
    expect(current).toBe(null)
    image.undo()
    expect(image.matches(first)).toBe(true)
    expect(videos.expand(current ?? '') === first).toBe(true)
    expect(videos.wordCount(ref).all).toBe('data:video/mp4;base64,'.length)
  })

  it('transmits only new payloads and can retry without an acknowledged base', () => {
    const videos = new VideoAttachments()
    const old = video(first) + '😀' + video(second)
    const current = '前😀' + video(second) + video(first) + video(second)
    const base = { markdown: videos.compact(old), revision: 5 }
    const packed = videos.compact(current)
    const changed = videos.checkpoint(packed, base)
    expect(changed.reuse?.revision).toBe(5)
    expect(changed.reuse?.spans).toHaveLength(2)
    expect(changed.markdown.length).toBeLessThan(second.length + 280)
    let restored = changed.markdown
    for (const { at, from, length } of [...(changed.reuse?.spans ?? [])].reverse())
      restored = restored.slice(0, at) + old.slice(from, from + length) + restored.slice(at)
    expect(restored === current).toBe(true)
    expect(videos.checkpoint(packed, null).markdown === current).toBe(true)
    expect(videos.checkpoint('removed', base)).toEqual({ markdown: 'removed' })
  })
})
