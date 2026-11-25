import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { diskVideoDirectory, diskVideoInfo } from '@shared/diskVideo'
import { importDiskVideo, readVideoMarkdown } from 'main_renderer/filesystem/diskVideo'
import { writeMarkdownFile } from 'main_renderer/filesystem/markdown'

let directory: string
vi.mock('electron', () => ({ app: { getPath: () => directory } }))
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

beforeEach(async() => {
  directory = await mkdtemp(join(tmpdir(), 'mt-video-'))
})
afterEach(async() => {
  await rm(directory, { recursive: true, force: true })
})

it.each(['utf8', 'utf16le', 'utf16be', 'utf32le', 'utf32be'])(
  'preserves repeated attachments, split headers, and surrounding %s text byte for byte',
  async encoding => {
    const file = join(directory, 'clip.mp4')
    const bytes = Buffer.alloc(800_002, 123)
    await writeFile(file, bytes)
    const source = await importDiskVideo(file)
    const width = iconv.encode('a', encoding).length
    const prefix = 'a'.repeat(768 * 1024 / width - 16)
    const compact = prefix + `<video src="${source}"></video>\n中文😀\n<video src="${source}"></video>`
    const path = join(directory, 'note.md')
    await writeMarkdownFile(path, compact, { lineEnding: 'lf', adjustLineEndingOnSave: false, encoding: { encoding, isBom: true } })
    const raw = await readFile(path)
    const expected = compact.replace(/~amv-[a-f\d]{64}~/g, bytes.toString('base64'))
    expect(raw.equals(iconv.encode(expected, encoding, { addBOM: true }))).toBe(true)
    const reopened = await readVideoMarkdown(path)
    expect(iconv.decode(reopened.buffer, encoding) === compact).toBe(true)
    expect(reopened.sizeBytes).toBe(raw.length)
    expect(reopened.rawSha256).toBe(createHash('sha256').update(raw).digest('hex'))
  }
)

it('preserves the previous document if attachment integrity fails during save', async() => {
  const file = join(directory, 'clip.mp4')
  await writeFile(file, 'original')
  const source = await importDiskVideo(file)
  const info = diskVideoInfo(source)
  if (!info) throw new Error('Missing attachment')
  await writeFile(join(directory, diskVideoDirectory, info.filename), 'modified')
  const target = join(directory, 'note.md')
  await writeFile(target, 'Previous content')
  await expect(writeMarkdownFile(target, `<video src="${source}"></video>`, {
    lineEnding: 'lf', adjustLineEndingOnSave: false, encoding: { encoding: 'utf8' }
  })).rejects.toThrow('checksum')
  expect(await readFile(target, 'utf8')).toBe('Previous content')
})
