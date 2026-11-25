const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/apng': 'apng',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif'
}

export const videoFormats: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov',
  'video/x-m4v': 'm4v', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
  'video/mpeg': 'mpeg', 'video/3gpp': '3gp'
}

export function videoMime(path: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)?.[1].toLowerCase()
  if (ext === 'mpg') return 'video/mpeg'
  return Object.keys(videoFormats).find(mime => videoFormats[mime] === ext) ?? ''
}

const mimeByExtension = new Map(Object.entries(extensions).map(([mime, ext]) => [ext, mime]))
mimeByExtension.set('jpg', 'image/jpeg')
mimeByExtension.set('jpeg', 'image/jpeg')
mimeByExtension.set('tif', 'image/tiff')

export function mimeFromImagePath(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase()
  return ext ? (mimeByExtension.get(ext) ?? '') : ''
}

export function embeddedImageExtension(mime: string): string {
  const extension = extensions[mime.toLowerCase()] ?? videoFormats[mime.toLowerCase()]
  if (!extension) throw new Error('Unsupported image format')
  return extension
}

export function embeddedImageFilename(name: string, mime: string): string {
  const ext = embeddedImageExtension(mime)
  const stem =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(?:jpe?g|png|apng|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif|mp4|webm|ogv|mov|m4v|mkv|avi|mpeg|mpg|3gp)$/i, '')
      .replace(/[<>:"|?*\p{Cc}]/gu, '-')
      .trim()
      .slice(0, 100)
      .replace(/[. ]+$/, '') || 'image'
  return (
    (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? '_' : '') + stem + '.' + ext
  )
}
