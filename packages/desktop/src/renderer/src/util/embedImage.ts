import { findEmbeddedImages } from '@muyajs/core'
import { clipboardImagePath, guessClipboardFilePath } from './clipboard'

const imageTypes: Record<string, string> = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', apng: 'apng', gif: 'gif', webp: 'webp',
  svg: 'svg+xml', avif: 'avif', bmp: 'bmp', ico: 'x-icon', tif: 'tiff', tiff: 'tiff'
}

export const isEmbeddedImageUrl = (text: string): boolean => {
  const image = findEmbeddedImages(text)[0]
  return !!image && image.src === text
}

function toDataUrl(blob: Blob): Promise<string> {
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid image')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return imageTypes[ext] ? 'image/' + imageTypes[ext] : ''
}

export async function embedImage(image: File | string, documentPath?: string | null): Promise<string> {
  if (typeof image !== 'string') return toDataUrl(image)
  if (isEmbeddedImageUrl(image)) return image
  if (/^https?:\/\//i.test(image)) {
    const result = await window.electron.clipboard.readImageSource(image)
    if (!result.ok) throw new Error(result.error)
    const mime = result.mime.split(';')[0].trim().toLowerCase()
    const type = mime.startsWith('image/') ? mime : mimeFromPath(new URL(image).pathname)
    return toDataUrl(new Blob([new Uint8Array(result.data)], { type }))
  }
  const path = /^file:\/\//i.test(image) ? clipboardImagePath(image) : image
  const absolute = documentPath ? window.path.resolve(window.path.dirname(documentPath), path) : path
  const type = mimeFromPath(absolute)
  if (!type || !window.path.isAbsolute(absolute)) throw new Error('Invalid image path')
  const bytes = await window.fileUtils.readFile(absolute)
  if (typeof bytes === 'string') throw new Error('Expected image bytes')
  return toDataUrl(new Blob([new Uint8Array(bytes)], { type }))
}

export async function readClipboardImage(): Promise<File | string | undefined> {
  const path = await guessClipboardFilePath()
  if (path && mimeFromPath(path)) return path
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const type = item.types.find(value => value.startsWith('image/'))
    if (type) return new File([await item.getType(type)], 'image', { type })
  }
}
