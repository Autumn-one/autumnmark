import { app, clipboard, ClipboardItem, ipcMain, nativeImage, net } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import { rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import log from 'electron-log'
import { embeddedImageFilename, videoMime } from '../../shared/embeddedImage'
import { cleanDiskVideosOnStartup, importDiskVideo } from '../filesystem/diskVideo'
import { diskVideoDirectory } from '@shared/diskVideo'

function decodeMedia(src: string, name: string) {
  const comma = src.indexOf(',')
  const header = /^data:((?:image|video)\/[\w.+-]+)(?:;[\w-]+=[\w.+-]+)*;base64$/i.exec(
    src.slice(0, comma)
  )
  if (!header || comma < 0) throw new Error('Invalid embedded media')
  return {
    filename: embeddedImageFilename(name, header[1]),
    mime: header[1],
    bytes: Buffer.from(src.slice(comma + 1), 'base64')
  }
}

// File references on the system clipboard must still resolve after the editor exits.
async function cacheClipboardVideo(src: string, name: string) {
  const path = src.startsWith('file:') ? fileURLToPath(src) : undefined
  if (path && dirname(path) !== join(app.getPath('userData'), diskVideoDirectory)) return
  const embedded = path ? undefined : decodeMedia(src, name)
  const mime = embedded?.mime ?? videoMime(path ?? '')
  if (!mime.startsWith('video/')) throw new Error('Expected a video')
  const filename = embeddedImageFilename(name, mime)
  const cache = join(app.getPath('userData'), 'Cache', 'clipboard-videos')
  const digest = embedded ? createHash('sha256').update(embedded.bytes).digest('hex') : basename(path ?? '').split('.')[0]
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid video attachment')
  const folder = join(cache, digest)
  await mkdir(folder, { recursive: true })
  const file = join(folder, filename)
  if (embedded) await writeFileAtomic(file, embedded.bytes)
  else if (path) await copyFile(path, file)
  return { file, cache, digest }
}

async function expireClipboardVideos(cache: string, current: string) {
  const before = Date.now() - 24 * 60 * 60_000
  for (const entry of await readdir(cache, { withFileTypes: true })) {
    if (entry.name === current || !entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name))
      continue
    const folder = join(cache, entry.name)
    const info = await stat(folder)
    if (info.mtimeMs < before) await rm(folder, { recursive: true, force: true })
  }
}

export function registerEmbeddedImageDrag() {
  cleanDiskVideosOnStartup()
  ipcMain.handle('mt::video::embed-file', (_event, pathname: string) => importDiskVideo(pathname))
  let directory: Promise<string> | undefined
  let ownedDirectory: string | undefined
  app.once('will-quit', () => {
    if (!ownedDirectory) return
    try {
      rmSync(ownedDirectory, { recursive: true, force: true, maxRetries: 2 })
    } catch (error) {
      log.warn('Unable to remove dragged image files', error)
    }
  })
  async function temporaryFile(filename: string) {
    directory ??= mkdtemp(join(app.getPath('temp'), 'autumnmark-images-'))
      .then((path) => {
        ownedDirectory = path
        return path
      })
      .catch((error) => {
        directory = undefined
        throw error
      })
    const folder = await mkdtemp(join(await directory, 'drag-'))
    return join(folder, filename)
  }

  function referencedVideo(src: string) {
    const path = fileURLToPath(src)
    if (!videoMime(path)) throw new Error('Unsupported video file')
    return path
  }

  async function materialize(src: string, name: string) {
    if (src.startsWith('file:')) {
      const path = referencedVideo(src)
      const file = await temporaryFile(embeddedImageFilename(name, videoMime(path)))
      await copyFile(path, file)
      return { file }
    }
    const { filename, mime, bytes } = decodeMedia(src, name)
    const file = await temporaryFile(filename)
    await writeFile(file, bytes)
    return {
      file,
      thumbnail: mime.startsWith('image/') ? nativeImage.createFromBuffer(bytes) : undefined
    }
  }

  ipcMain.handle('mt::video::download', async(_event, source: string) => {
    const url = new URL(source)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid video URL')
    const response = await net.fetch(url.href, {
      credentials: 'omit',
      signal: AbortSignal.timeout(120_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const type = !mime || mime === 'application/octet-stream' ? videoMime(url.pathname) : mime
    if (!type.startsWith('video/')) throw new Error('Expected a video')
    return { mime: type, data: new Uint8Array(await response.arrayBuffer()) }
  })
  ipcMain.handle('mt::video::copy-file', async(_event, src: string, name: string) => {
    const cached = await cacheClipboardVideo(src, name)
    const file = cached?.file ?? referencedVideo(src)
    await clipboard.write([new ClipboardItem({ 'text/uri-list': pathToFileURL(file).href })])
    if (cached)
      void expireClipboardVideos(cached.cache, cached.digest).catch((error) =>
        log.warn('Video clipboard cache cleanup failed', error)
      )
  })
  ipcMain.handle('mt::embedded-image::drag', async(event, src: string, name: string) => {
    const { file, thumbnail } = await materialize(src, name)
    const size = thumbnail?.getSize()
    const icon =
      thumbnail && size?.width && size.height
        ? thumbnail.resize(size.width >= size.height ? { width: 64 } : { height: 64 })
        : await app.getFileIcon(file)
    if (!event.sender.isDestroyed()) event.sender.startDrag({ file, icon })
  })
}
