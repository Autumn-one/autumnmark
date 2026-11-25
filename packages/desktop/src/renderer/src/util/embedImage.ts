import { findEmbeddedImages } from '@muyajs/core'
import { mimeFromImagePath } from '@shared/embeddedImage'
import { clipboardImagePath } from './clipboard'

export const isEmbeddedImageUrl = (text: string): boolean => {
  const image = findEmbeddedImages(text)[0]
  return !!image && image.src === text
}

export function toDataUrl(blob: Blob, kind: 'image' | 'video' = 'image'): Promise<string> {
  if (!blob.size || !blob.type.startsWith(kind + '/')) throw new Error('Invalid media file')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not encode media file'))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function embedImage(image: File | string, documentPath?: string | null): Promise<string> {
  if (typeof image !== 'string') return toDataUrl(image)
  if (isEmbeddedImageUrl(image)) return image
  if (/^https?:\/\//i.test(image)) {
    const result = await window.electron.clipboard.readImageSource(image)
    if (!result.ok) throw new Error(result.error)
    const mime = result.mime.split(';')[0].trim().toLowerCase()
    const type = mime.startsWith('image/') ? mime : mimeFromImagePath(new URL(image).pathname)
    return toDataUrl(new Blob([new Uint8Array(result.data)], { type }))
  }
  const path = /^file:\/\//i.test(image) ? clipboardImagePath(image) : image
  const absolute = documentPath ? window.path.resolve(window.path.dirname(documentPath), path) : path
  const type = mimeFromImagePath(absolute)
  if (!type || !window.path.isAbsolute(absolute)) throw new Error('Invalid image path')
  const bytes = await window.fileUtils.readFile(absolute)
  if (typeof bytes === 'string') throw new Error('Expected image bytes')
  return toDataUrl(new Blob([new Uint8Array(bytes)], { type }))
}

export async function readClipboardImage(kind?: 'video'): Promise<File | string | undefined> {
  const input = await window.electron.clipboard.readImageInput(kind)
  if (!input) return
  if (typeof input === 'string') return input
  return new File([new Uint8Array(input.data)], kind ?? 'image', { type: input.mime })
}
