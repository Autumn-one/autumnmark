import { embeddedImageExtension, videoMime } from '@shared/embeddedImage'
import { usePreferencesStore } from '@/store/preferences'
import { t } from '@/i18n'
import { clipboardImagePath } from './clipboard'
import { encodeDirnameForUrl, localPathToFileUrl } from './fileUrl'
import { resolveLocalLinkHref } from './resolveLinkHref'
import { toDataUrl } from './embedImage'
import type { VideoAttachments } from './videoAttachments'
import { diskVideoUrl } from './videoAttachments'
import { diskVideoInfo, diskVideoThreshold } from '@shared/diskVideo'

export const isVideoData = (src: string) =>
  !!diskVideoInfo(src) || /^data:video\/[\w.+-]+(?:;[\w-]+=[\w.+-]+)*;base64,[a-z\d+/]+={0,2}$/i.test(src)

export function videoPlaybackUrl(src: string) {
  return /^data:video\//i.test(src) ? diskVideoUrl(src) ?? src : resolveLocalLinkHref(src.replace(/&amp;/g, '&'))
}

export async function videoTransferSource(src: string) {
  const url = videoPlaybackUrl(src)
  return url.startsWith('file:') ? url : videoData(url)
}

export async function videoFile(input: File | string): Promise<File> {
  if (typeof input !== 'string') {
    const mime = input.type.split(';')[0].toLowerCase()
    const type = mime.startsWith('video/') ? mime : videoMime(input.name)
    if (!type) throw new Error(t('video.invalid'))
    return type === input.type ? input : new File([input], input.name, { type })
  }
  if (isVideoData(input)) {
    const mime = input.slice(5, input.indexOf(';')).toLowerCase()
    const bytes = Uint8Array.fromBase64(input.slice(input.indexOf(',') + 1))
    return new File([bytes], 'video.' + embeddedImageExtension(mime), { type: mime })
  }
  if (/^https?:\/\//i.test(input)) {
    const { data, mime } = await window.electron.ipcRenderer.invoke('mt::video::download', input)
    return new File([new Uint8Array(data)], new URL(input).pathname.split('/').pop() || 'video', {
      type: mime
    })
  }
  const path = input.startsWith('file:') ? clipboardImagePath(input) : input
  const type = videoMime(path)
  if (!type || !window.path.isAbsolute(path)) throw new Error(t('video.invalid'))
  const bytes = await window.fileUtils.readFile(path)
  if (typeof bytes === 'string') throw new Error(t('video.invalid'))
  return new File([new Uint8Array(bytes)], window.path.basename(path), { type })
}

export async function videoData(input: File | string) {
  if (typeof input === 'string' && isVideoData(input)) return input
  return toDataUrl(await videoFile(input), 'video')
}

export async function embedVideo(input: File | string) {
  if (typeof input === 'string') {
    if (/^(?:https?:|data:)/i.test(input)) return videoData(input)
    const path = input.startsWith('file:') ? clipboardImagePath(input) : input
    if (window.path.isAbsolute(path)) {
      const { size } = await window.fileUtils.stat(path)
      if (size >= diskVideoThreshold) return window.electron.ipcRenderer.invoke('mt::video::embed-file', path)
    }
  } else if (input.size >= diskVideoThreshold) {
    const path = window.electron.webUtils.getPathForFile(input)
    if (path) return window.electron.ipcRenderer.invoke('mt::video::embed-file', path)
  }
  return videoData(input)
}

export function savedVideoDocument(tab?: { pathname?: string | null; isPendingCreation?: boolean } | null) {
  return tab?.isPendingCreation ? undefined : tab?.pathname
}

function fileReference(path: string, documentPath?: string | null) {
  if (documentPath) {
    const relative = window.path.relative(window.path.dirname(documentPath), path)
    if (!window.path.isAbsolute(relative))
      return relative.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  }
  return new URL(localPathToFileUrl(encodeDirnameForUrl(path))).href
}

export async function videoSource(
  input: File | string,
  embed: boolean,
  documentPath?: string | null
) {
  if (embed) return embedVideo(input)
  if (typeof input === 'string' && /^https?:\/\//i.test(input)) return input
  let path =
    typeof input === 'string'
      ? isVideoData(input)
        ? ''
        : input
      : window.electron.webUtils.getPathForFile(input)
  // Files offered to the OS for drag or clipboard use can disappear after the document is saved.
  const normalized = path.replace(/\\/g, '/')
  const temporary = /\/Cache\/clipboard-videos\/[a-f0-9]{64}\/[^/]+$/i.test(normalized) ||
    /\/autumnmark-images-[\w-]+\/drag-[\w-]+\/[^/]+$/i.test(normalized)
  if (!path || temporary) {
    const file = await videoFile(input)
    const extension = embeddedImageExtension(file.type)
    path =
      (await window.electron.dialog.showSave({
        title: t('video.saveAs'),
        defaultPath: file.name,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
      })) || ''
    if (!path) return ''
    await window.fileUtils.writeFile(path, new Uint8Array(await file.arrayBuffer()))
  }
  return fileReference(path.startsWith('file:') ? clipboardImagePath(path) : path, documentPath)
}

export async function videoMarkdown(input: File | string, documentPath?: string | null, videos?: VideoAttachments | null) {
  const src = await videoSource(input, usePreferencesStore().embedVideos, documentPath)
  if (!src) return ''
  let name = ''
  if (typeof input !== 'string') name = input.name
  else if (/^https?:\/\//i.test(input)) name = new URL(input).pathname.split('/').pop() ?? ''
  else if (!/^data:/i.test(input)) name = window.path.basename(input)
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    '<video controls preload="metadata" title="' +
    escape(name) +
    '" src="' +
    escape(videos ? videos.compactSource(src) : src) +
    '"></video>'
  )
}

export async function validateVideo(src: string) {
  const player = document.createElement('video')
  player.preload = 'metadata'
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(t('video.invalid'))), 30_000)
      player.onloadedmetadata = () => {
        clearTimeout(timer)
        if (player.videoWidth) resolve()
        else reject(new Error(t('video.invalid')))
      }
      player.onerror = () => {
        clearTimeout(timer)
        reject(new Error(t('video.invalid')))
      }
      player.src = videoPlaybackUrl(src)
    })
  } finally {
    player.onloadedmetadata = player.onerror = null
    player.removeAttribute('src')
    player.load()
  }
}

export const pickVideo = () => window.electron.ipcRenderer.invoke('mt::ask-for-image-path', 'video')
