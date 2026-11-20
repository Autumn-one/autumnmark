import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import log from 'electron-log'
import { diskVideoDirectory, diskVideoFilename, diskVideoHeader, diskVideoReferences } from '@shared/diskVideo'
import { videoMime } from '@shared/embeddedImage'

const chunkSize = 768 * 1024
const directory = () => join(app.getPath('userData'), diskVideoDirectory)
let startupCleanup = Promise.resolve()

async function removeUnusedVideos() {
  const folder = directory()
  const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  const unused = new Set(files.filter(name => /^(?:[a-f\d]{64}\.\w+|[a-f\d-]{36}\.tmp)$/.test(name)))
  if (!unused.size) return
  const recovery = join(app.getPath('userData'), 'recovery')
  const windows = await readdir(recovery, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  for (const win of windows) {
    if (!win.isDirectory()) continue
    const records = join(recovery, win.name)
    for (const name of await readdir(records)) {
      if (!name.endsWith('.json')) continue
      const record = await readFile(join(records, name), 'utf8')
      for (const match of record.matchAll(diskVideoReferences())) {
        unused.delete(diskVideoFilename(match[1], match[3]))
      }
    }
  }
  for (const name of unused) await rm(join(folder, name), { force: true })
}

export function cleanDiskVideosOnStartup() {
  // A running renderer can still reference deleted videos through its undo stack.
  if (app.hasSingleInstanceLock()) {
    startupCleanup = removeUnusedVideos().catch(error => log.warn('Video attachment cleanup failed', error))
  }
}

async function stageVideo(mime: string) {
  await startupCleanup
  const folder = directory()
  await mkdir(folder, { recursive: true })
  const temporary = join(folder, randomUUID() + '.tmp')
  const file = await open(temporary, 'wx', 0o600)
  const hash = createHash('sha256')
  let size = 0
  return {
    async append(bytes: Buffer) {
      await file.writeFile(bytes)
      hash.update(bytes)
      size += bytes.length
    },
    async finish() {
      const digest = hash.digest('hex')
      await file.sync()
      await file.close()
      const target = join(folder, diskVideoFilename(mime, digest))
      try {
        await link(temporary, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') {
          if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'ENOSYS') throw error
          await rename(temporary, target)
        }
      }
      return { marker: '~amv-' + digest + '~', size }
    },
    async dispose() {
      await file.close()
      await rm(temporary, { force: true })
    }
  }
}

export async function importDiskVideo(pathname: string) {
  const mime = videoMime(pathname)
  if (!mime) throw new Error('Unsupported video file')
  const video = await stageVideo(mime)
  try {
    for await (const bytes of createReadStream(pathname, { highWaterMark: chunkSize })) {
      await video.append(bytes)
    }
    const { size, marker } = await video.finish()
    return `data:${mime};am-size=${size};base64,${marker}`
  } finally {
    await video.dispose()
  }
}

// Only ASCII from the URL is interpreted. The surrounding document retains its original encoding and BOM.
const views = ['latin1', 'utf16le', 'utf16be', 'utf32le', 'utf32be'].map(encoding => ({
  encoding,
  width: iconv.encode('a', encoding).length,
  prefix: iconv.encode('data:video/', encoding)
}))
const headerLookahead = 512

export async function readVideoMarkdown(pathname: string) {
  const hash = createHash('sha256')
  const parts: Buffer[] = []
  let tail = Buffer.alloc(0)
  let active: {
    video: Awaited<ReturnType<typeof stageVideo>>
    view: typeof views[number]
    remaining: number
    size: number
  } | undefined
  let sizeBytes = 0
  let wideEncoding: string | undefined
  try {
    for await (const bytes of createReadStream(pathname, { highWaterMark: chunkSize })) {
      hash.update(bytes)
      sizeBytes += bytes.length
      const chunk = tail.length ? Buffer.concat([tail, bytes]) : bytes
      let pos = 0
      while (pos < chunk.length) {
        if (active) {
          const { view, video } = active
          const quartets = Math.floor((chunk.length - pos) / (4 * view.width))
          const length = Math.min(active.remaining, quartets * 4) * view.width
          if (!length) break
          const text = iconv.decode(chunk.subarray(pos, pos + length), view.encoding)
          const decoded = Buffer.from(text, 'base64')
          if (decoded.toString('base64') !== text) throw new Error('Invalid embedded video data')
          await video.append(decoded)
          pos += length
          active.remaining -= text.length
          if (!active.remaining) {
            const { marker, size } = await video.finish()
            if (size !== active.size) throw new Error('Embedded video size mismatch')
            parts.push(iconv.encode(marker, view.encoding))
            await video.dispose()
            active = undefined
          }
          continue
        }
        let start = chunk.length
        let view = views[0]
        for (const candidate of views) {
          let index = chunk.indexOf(candidate.prefix, pos)
          while (index >= 0 && (sizeBytes - chunk.length + index) % candidate.width) {
            index = chunk.indexOf(candidate.prefix, index + 1)
          }
          if (index >= 0 && index < start) {
            start = index
            view = candidate
          }
        }
        if (chunk.length - start < headerLookahead) {
          const end = Math.max(pos, chunk.length - headerLookahead)
          parts.push(chunk.subarray(pos, end))
          pos = end
          break
        }
        const header = diskVideoHeader.exec(iconv.decode(chunk.subarray(start, start + headerLookahead), view.encoding))
        const size = Number(header?.[2])
        if (!header || !Number.isSafeInteger(size) || size <= 0) {
          const end = start + view.prefix.length
          parts.push(chunk.subarray(pos, end))
          pos = end
          continue
        }
        const end = start + header[0].length * view.width
        if (view.width > 1) wideEncoding = view.encoding
        parts.push(chunk.subarray(pos, end))
        pos = end
        active = { video: await stageVideo(header[1]), size, remaining: Math.ceil(size / 3) * 4, view }
      }
      tail = Buffer.from(chunk.subarray(pos))
    }
    if (active) throw new Error('Incomplete embedded video')
    parts.push(tail)
    return { buffer: Buffer.concat(parts), wideEncoding, sizeBytes, rawSha256: hash.digest('hex') }
  } finally {
    await active?.video.dispose()
  }
}

export async function* expandDiskVideos(content: string, encoding: string, isBom: boolean) {
  const encoder = iconv.getEncoder(encoding, { addBOM: isBom })
  let pos = 0
  for (const match of content.matchAll(diskVideoReferences())) {
    const marker = match[0].indexOf('~')
    yield encoder.write(content.slice(pos, match.index + marker))
    const file = join(directory(), diskVideoFilename(match[1], match[3]))
    if ((await stat(file)).size !== Number(match[2])) throw new Error('Embedded video size mismatch')
    const hash = createHash('sha256')
    let tail = Buffer.alloc(0)
    for await (const bytes of createReadStream(file, { highWaterMark: chunkSize })) {
      hash.update(bytes)
      const chunk = tail.length ? Buffer.concat([tail, bytes]) : bytes
      const end = chunk.length - chunk.length % 3
      yield encoder.write(chunk.toString('base64', 0, end))
      tail = Buffer.from(chunk.subarray(end))
    }
    if (hash.digest('hex') !== match[3]) throw new Error('Embedded video checksum mismatch')
    if (tail.length) yield encoder.write(tail.toString('base64'))
    pos = match.index + match[0].length
  }
  yield encoder.write(content.slice(pos))
  const end = encoder.end()
  if (end) yield end
}
