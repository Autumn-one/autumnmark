import { createHash } from 'node:crypto'
import type { RemoteContent, RemoteContentKind, RemoteContentSnapshot } from '@shared/types/ipc'

const REPOSITORY = 'Autumn-one/notify'
const BRANCH = 'main'
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}`
const FILES: Record<RemoteContentKind, string> = {
  announcement: 'README.md',
  about: 'info.md'
}

// KeyDoing's announcementSources and personalInfoSources share this priority order.
const MIRROR_PREFIXES = [
  'https://proxy.gitwarp.top/',
  'https://ghfast.top/',
  'https://gh-proxy.org/',
  'https://v4.gh-proxy.org/',
  'https://v6.gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  ''
]
const MAX_MARKDOWN_BYTES = 512 * 1024
const SOURCE_TIMEOUT_MS = 5000

type FetchSource = (url: string, init: RequestInit) => Promise<Response>

const readBody = async(response: Response, limit: number): Promise<string | null> => {
  const reader = response.body?.getReader()
  if (!reader) return null

  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()

      bytes += value.byteLength
      if (bytes > limit) return null
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const downloadMarkdown = async(
  url: URL,
  fetchSource: FetchSource,
  verified: boolean
): Promise<string | null> => {
  try {
    const response = await fetchSource(url.href, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: verified ? 'application/vnd.github+json' : 'text/plain, text/markdown',
        'User-Agent': 'AutumnMark'
      }
    })
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel()
      return null
    }

    let markdown = await readBody(response, verified ? MAX_MARKDOWN_BYTES * 2 : MAX_MARKDOWN_BYTES)
    if (markdown === null) return null

    if (verified) {
      const file = JSON.parse(markdown)
      if (file?.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
        return null
      }
      const bytes = Buffer.from(file.content, 'base64')
      if (bytes.length > MAX_MARKDOWN_BYTES) return null
      markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }

    return markdown.trim() && !/^\s*<(?:!doctype\b|html[\s>])/i.test(markdown) ? markdown : null
  } catch {
    return null
  }
}

export const fetchRemoteContent = async(
  kind: RemoteContentKind,
  fetchSource: FetchSource
): Promise<RemoteContent | null> => {
  const filename = FILES[kind]
  const cacheBuster = Date.now().toString()
  if (kind === 'announcement') {
    // A mirror can serve an older revision even when the request bypasses the HTTP cache.
    const origin = new URL(`https://api.github.com/repos/${REPOSITORY}/contents/${filename}`)
    origin.searchParams.set('ref', BRANCH)
    origin.searchParams.set('_', cacheBuster)
    const markdown = await downloadMarkdown(origin, fetchSource, true)
    if (markdown) return { markdown, verified: true }
  }

  for (const prefix of MIRROR_PREFIXES) {
    const url = new URL(`${prefix}${RAW_BASE}/${filename}`)
    url.searchParams.set('_', cacheBuster)
    const markdown = await downloadMarkdown(url, fetchSource, false)
    if (markdown) return { markdown, verified: false }
  }

  return null
}

export class RemoteContentCache {
  private readonly cached = new Map<RemoteContentKind, RemoteContentSnapshot>()
  private readonly inFlight = new Map<RemoteContentKind, Promise<RemoteContentSnapshot>>()

  constructor(
    private readonly fetchSource: FetchSource,
    private readonly onAnnouncementChanged?: (snapshot: RemoteContentSnapshot) => void
  ) {}

  async load(kind: unknown, refresh = false): Promise<RemoteContentSnapshot> {
    if (kind !== 'announcement' && kind !== 'about') {
      return { content: null, status: 'failed' }
    }

    const pending = this.inFlight.get(kind)
    if (pending) return pending

    const cached = this.cached.get(kind)
    if (cached && !refresh) return cached

    const request = this.update(kind, cached?.content ?? null)
    this.inFlight.set(kind, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(kind)
    }
  }

  private async update(
    kind: RemoteContentKind,
    previous: RemoteContent | null
  ): Promise<RemoteContentSnapshot> {
    const fetched = await fetchRemoteContent(kind, this.fetchSource)
    // An older mirror revision must not replace an announcement verified by GitHub.
    const content = fetched && (!previous?.verified || fetched.verified) ? fetched : previous
    const snapshot: RemoteContentSnapshot = {
      content,
      status: !fetched ? 'failed' : kind === 'announcement' && !fetched.verified ? 'unverified' : 'ready'
    }
    if (content) {
      const last = this.cached.get(kind)
      if (kind === 'announcement') {
        snapshot.announcementRevision = createHash('sha256').update(content.markdown).digest('hex')
      }
      this.cached.set(kind, snapshot)
      if (kind === 'announcement' && (
        snapshot.announcementRevision !== last?.announcementRevision || content.verified !== last?.content?.verified
      )) {
        this.onAnnouncementChanged?.(snapshot)
      }
    }
    return snapshot
  }
}
