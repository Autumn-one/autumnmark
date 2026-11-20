import { videoFormats } from './embeddedImage'

// Above this size, IPC and the document model carry only an immutable attachment reference.
export const diskVideoThreshold = 32 * 1024 * 1024
export const diskVideoDirectory = 'video-attachments'
// The MIME parameter gives the reader a payload boundary even when the HTML tag spans gigabytes.
const headerPattern = 'data:(video/[\\w.+-]{1,64});am-size=(\\d{1,16});base64,'
export const diskVideoHeader = new RegExp('^' + headerPattern, 'i')
export const diskVideoReferences = () =>
  new RegExp(headerPattern + '~amv-([a-f\\d]{64})~', 'gi')

export function diskVideoFilename(mime: string, digest: string) {
  return digest + '.' + (videoFormats[mime.toLowerCase()] ?? 'video')
}

export function diskVideoInfo(src: string) {
  if (!src.endsWith('~')) return
  const match = diskVideoReferences().exec(src)
  if (match?.[0] === src) {
    return { mime: match[1], size: Number(match[2]), filename: diskVideoFilename(match[1], match[3]) }
  }
}
