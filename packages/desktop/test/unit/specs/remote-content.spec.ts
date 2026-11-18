import { describe, expect, it, vi } from 'vitest'
import { fetchRemoteContent, RemoteContentCache } from '../../../src/main/ipc/remoteContent'

const githubFile = (markdown: string): Response => Response.json({
  type: 'file',
  encoding: 'base64',
  content: Buffer.from(markdown).toString('base64')
})

describe('remote announcement and about content', () => {
  it('verifies the announcement with GitHub before trying mirrors', async() => {
    const markdown = '# 最新公告'
    const fetchSource = vi.fn(async(_url: string) => githubFile(markdown))

    await expect(fetchRemoteContent('announcement', fetchSource)).resolves.toEqual({
      markdown,
      verified: true
    })
    expect(fetchSource).toHaveBeenCalledTimes(1)
    const url = new URL(fetchSource.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(
      'https://api.github.com/repos/Autumn-one/notify/contents/README.md'
    )
    expect(url.searchParams.get('ref')).toBe('main')
    expect(url.searchParams.get('_')).toMatch(/^\d+$/)
  })

  it('keeps the KeyDoing mirror order and falls back to GitHub Raw for about information', async() => {
    const markdown = '## 动态信息'
    const fetchSource = vi.fn(async(url: string) => {
      const { hostname } = new URL(url)
      if (hostname === 'raw.githubusercontent.com') return new Response(markdown)
      if (hostname === 'proxy.gitwarp.top') return new Response('<html>Unavailable</html>')
      if (hostname === 'ghfast.top') throw new Error('connection timed out')
      return new Response(null, { status: 503 })
    })

    await expect(fetchRemoteContent('about', fetchSource)).resolves.toEqual({
      markdown,
      verified: false
    })
    const urls = fetchSource.mock.calls.map(([url]) => new URL(url))
    expect(urls.map(({ hostname }) => hostname)).toEqual([
      'proxy.gitwarp.top',
      'ghfast.top',
      'gh-proxy.org',
      'v4.gh-proxy.org',
      'v6.gh-proxy.org',
      'cdn.gh-proxy.org',
      'raw.githubusercontent.com'
    ])
    expect(urls.every(({ pathname }) => pathname.endsWith('/Autumn-one/notify/main/info.md'))).toBe(true)
  })

  it('uses the announcement mirrors when GitHub cannot verify the current revision', async() => {
    const fetchSource = vi.fn(async(url: string) => {
      if (new URL(url).hostname === 'api.github.com') return Response.json({ type: 'dir' })
      return new Response('# 公告')
    })

    await expect(fetchRemoteContent('announcement', fetchSource)).resolves.toEqual({
      markdown: '# 公告',
      verified: false
    })
    expect(fetchSource.mock.calls[1][0]).toContain(
      'https://proxy.gitwarp.top/https://raw.githubusercontent.com/Autumn-one/notify/main/README.md'
    )
  })

  it('accepts only the two feed names across IPC', async() => {
    const fetchSource = vi.fn()
    const cache = new RemoteContentCache(fetchSource)

    await expect(cache.load('https://example.com')).resolves.toEqual({
      content: null,
      status: 'failed'
    })
    expect(fetchSource).not.toHaveBeenCalled()
  })

  it('shares the startup downloads with early opens and serves the warmed content on later opens', async() => {
    const fetchSource = vi.fn(async(url: string) => {
      if (new URL(url).hostname === 'api.github.com') return githubFile('# 公告')
      return new Response('## 动态信息')
    })
    const cache = new RemoteContentCache(fetchSource)

    const announcementPrefetch = cache.load('announcement')
    const aboutPrefetch = cache.load('about')
    const earlyAnnouncementOpen = cache.load('announcement')
    const earlyAboutOpen = cache.load('about')
    expect(fetchSource).toHaveBeenCalledTimes(2)

    const [announcement, about] = await Promise.all([announcementPrefetch, aboutPrefetch])
    expect(announcement.content?.markdown).toBe('# 公告')
    expect(about.content?.markdown).toBe('## 动态信息')
    await expect(earlyAnnouncementOpen).resolves.toEqual(announcement)
    await expect(earlyAboutOpen).resolves.toEqual(about)
    await expect(cache.load('announcement')).resolves.toEqual(announcement)
    await expect(cache.load('about')).resolves.toEqual(about)
    expect(fetchSource).toHaveBeenCalledTimes(2)
  })

  it('allows a first open to retry a failed prefetch and keeps the warmed content if refresh fails', async() => {
    const fetchSource = vi.fn(async() => new Response(null, { status: 503 }))
    const cache = new RemoteContentCache(fetchSource)

    await expect(cache.load('about')).resolves.toEqual({ content: null, status: 'failed' })
    fetchSource.mockResolvedValueOnce(new Response('## 动态信息'))
    const content = { markdown: '## 动态信息', verified: false }
    await expect(cache.load('about')).resolves.toEqual({ content, status: 'ready' })
    await expect(cache.load('about', true)).resolves.toEqual({ content, status: 'failed' })
  })

  it('keeps a verified announcement in the shared cache when only a mirror is reachable', async() => {
    const fetchSource = vi.fn(async(url: string) => {
      if (new URL(url).hostname === 'api.github.com') return new Response(null, { status: 503 })
      return new Response('# 旧公告')
    }).mockResolvedValueOnce(githubFile('# 最新公告'))
    const changed = vi.fn()
    const cache = new RemoteContentCache(fetchSource, changed)
    const content = { markdown: '# 最新公告', verified: true }

    const initial = await cache.load('announcement')
    expect(initial).toEqual({ content, status: 'ready', announcementRevision: expect.stringMatching(/^[a-f0-9]{64}$/) })
    await expect(cache.load('announcement', true)).resolves.toEqual({ ...initial, status: 'unverified' })
    await expect(cache.load('announcement')).resolves.toEqual({ ...initial, status: 'unverified' })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('announces a changed body once and keeps its revision stable across launches', async() => {
    let markdown = '# Original'
    const fetchSource = async() => githubFile(markdown)
    const changed = vi.fn()
    const cache = new RemoteContentCache(fetchSource, changed)
    const original = await cache.load('announcement')
    await cache.load('announcement', true)
    markdown = '# Updated'
    const updated = await cache.load('announcement', true)
    expect(updated.announcementRevision).not.toBe(original.announcementRevision)
    expect(changed.mock.calls).toEqual([[original], [updated]])
    await expect(new RemoteContentCache(fetchSource).load('announcement')).resolves.toEqual(updated)
  })
})
