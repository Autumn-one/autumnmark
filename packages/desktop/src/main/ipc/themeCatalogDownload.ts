import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { isLocalTheme, type LocalTheme } from '@shared/localTheme'
import { parseThemeCatalog, supportsCatalogTheme, themeCatalogBase, type CatalogTheme, type ThemeCatalogSnapshot } from '@shared/themeCatalog'

const maxCatalogBytes = 512 * 1024
const maxThemeBytes = 256 * 1024
const maxCachedThemes = 8

export class ThemeCatalogDownload {
  private snapshot?: ThemeCatalogSnapshot
  private pending?: Promise<ThemeCatalogSnapshot>
  private readonly downloads = new Map<string, Promise<LocalTheme>>()

  constructor(
    private readonly cache: string,
    private readonly appVersion: string,
    private readonly fetcher: (url: string, options: RequestInit) => Promise<Response>
  ) {}

  list(refresh: boolean): Promise<ThemeCatalogSnapshot> {
    if (this.pending) return this.pending
    if (this.snapshot && !refresh) return Promise.resolve(this.snapshot)
    this.pending = this.refresh().finally(() => { this.pending = undefined })
    return this.pending
  }

  download(entry: CatalogTheme): Promise<LocalTheme> {
    const key = `${entry.base}:${entry.sha256}`
    const cached = this.downloads.get(key)
    if (cached) return cached
    const request = this.readTheme(entry).catch(error => {
      if (this.downloads.get(key) === request) this.downloads.delete(key)
      throw error
    })
    this.downloads.set(key, request)
    const oldest = this.downloads.keys().next().value
    if (this.downloads.size > maxCachedThemes && oldest !== undefined) this.downloads.delete(oldest)
    return request
  }

  private async readTheme(entry: CatalogTheme): Promise<LocalTheme> {
    const file = await this.read(entry.path, maxThemeBytes)
    if (createHash('sha256').update(file).digest('hex') !== entry.sha256) throw new Error('Invalid theme checksum')
    const theme: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file))
    if (!isLocalTheme(theme) || theme.base !== entry.base) throw new Error('Invalid theme file')
    return theme
  }

  private async refresh(): Promise<ThemeCatalogSnapshot> {
    const decode = (bytes: Uint8Array) => {
      const manifest: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      return parseThemeCatalog(manifest).map(theme => ({
        ...theme,
        compatible: supportsCatalogTheme(theme, this.appVersion)
      }))
    }
    try {
      const bytes = await this.read('catalog.json', maxCatalogBytes)
      const themes = decode(bytes)
      await mkdir(path.dirname(this.cache), { recursive: true })
        .then(() => writeFileAtomic(this.cache, bytes))
        .catch(() => {})
      this.snapshot = { themes, status: 'ready' }
    } catch {
      let themes = this.snapshot?.themes
      if (!themes) {
        try {
          const bytes = await readFile(this.cache)
          if (bytes.length <= maxCatalogBytes) themes = decode(bytes)
        } catch {
          themes = undefined
        }
      }
      this.snapshot = themes ? { themes, status: 'cached' } : { themes: [], status: 'unavailable' }
    }
    return this.snapshot
  }

  private async read(asset: string, limit: number): Promise<Buffer> {
    const response = await this.fetcher(new URL(asset, themeCatalogBase).href, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-cache'
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Theme download unavailable')
    }
    const reader = response.body.getReader()
    try {
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return Buffer.concat(chunks, size)
        size += value.length
        if (size > limit) throw new Error('Theme download too large')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
}
