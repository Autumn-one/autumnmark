import { createHash } from 'node:crypto'
import { mkdtemp, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { ThemeCatalogDownload } from '../../../src/main/ipc/themeCatalogDownload'
import { parseThemeCatalog, themeCatalogBase } from '../../../src/shared/themeCatalog'

const file = JSON.stringify({
  version: 1,
  id: 'local:nord:12345678-1234-4567-8234-123456789012',
  name: 'Evening Paper',
  base: 'nord',
  values: { accent: '#aabbcc' }
})
const entry = {
  id: 'author/evening-paper',
  name: 'Evening Paper',
  author: 'Author',
  base: 'nord',
  revision: 1,
  path: 'themes/evening-paper/1/theme.theme.json',
  sha256: createHash('sha256').update(file).digest('hex')
}

it('rejects catalog paths outside the official project, duplicate IDs and non-image previews', () => {
  for (const patch of [
    { path: 'https://example.com/theme.theme.json' },
    { path: '../outside.theme.json' },
    { preview: 'themes/preview.svg' }
  ]) {
    expect(() => parseThemeCatalog({ version: 1, themes: [{ ...entry, ...patch }] })).toThrow()
  }
  expect(() => parseThemeCatalog({ version: 1, themes: [entry, entry] })).toThrow()
})

it('verifies downloaded themes and keeps the last valid catalog across restarts', async() => {
  const directory = await mkdtemp(path.join(tmpdir(), 'autumnmark-catalog-'))
  const cache = path.join(directory, 'catalog.json')
  try {
    const newer = { ...entry, id: 'newer-theme', minAppVersion: '2.0.0' }
    const fetcher = vi.fn(async(url: string) => url.endsWith('/catalog.json')
      ? Response.json({ version: 1, themes: [entry, newer] })
      : new Response(file))
    const catalog = new ThemeCatalogDownload(cache, '0.24.0-preview.1', fetcher)
    const snapshot = await catalog.list(false)
    expect(snapshot).toMatchObject({ status: 'ready', themes: [{ compatible: true }, { compatible: false }] })
    const [preview, install] = await Promise.all([catalog.download(entry), catalog.download(entry)])
    expect(preview).toMatchObject({ name: entry.name, base: entry.base })
    expect(install).toEqual(preview)
    expect(fetcher).toHaveBeenCalledWith(themeCatalogBase + entry.path, expect.objectContaining({ redirect: 'error' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    await expect(catalog.download({ ...entry, sha256: '0'.repeat(64) })).rejects.toThrow('checksum')

    const offline = new ThemeCatalogDownload(cache, '0.24.0', async() => new Response('', { status: 503 }))
    await expect(offline.list(false)).resolves.toMatchObject({ status: 'cached', themes: snapshot.themes })
  } finally {
    await rm(cache, { force: true })
    await rmdir(directory)
  }
})
