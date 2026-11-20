/// <reference lib="esnext.typedarrays" />
import { findEmbeddedMedia, type IEmbeddedImageEdit, wordCount } from '@muyajs/core'
import type { ReusedContent } from '@shared/types/applicationState'
import { getHash } from './fileSystem'

const minimumDataUrlLength = 64 * 1024
const dataUrl = /data:video\/[\w.+-]+(?:;[\w-]+=[\w.+-]+)*;base64,[a-z\d+/]+={0,2}/gi
const reference = /\uE200[\uE300-\uE3FF]{16}\uE201/g

interface Attachment {
  payload: string
  urls: Map<string, string>
  digest?: Promise<string>
}

/** References live as long as the tab, including videos reachable only through undo. */
export class VideoAttachments {
  private readonly attachments = new Map<string, Attachment>()
  private readonly references = new Map<string, string>()

  compactSource(source: string): string {
    if (source.length < minimumDataUrlLength || !/^data:video\//i.test(source)) return source
    const comma = source.indexOf(',') + 1
    const payload = source.slice(comma)
    let ref = this.references.get(payload)
    if (!ref) {
      // Private-use characters keep ordinary find-and-replace queries out of attachment IDs.
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      ref = '\uE200' + Array.from(bytes, b => String.fromCharCode(0xE300 + b)).join('') + '\uE201'
      this.references.set(payload, ref)
      this.attachments.set(ref, { payload, urls: new Map() })
    }
    return source.slice(0, comma) + ref
  }

  compact(markdown: string): string {
    if (markdown.length < minimumDataUrlLength || !/data:video\//i.test(markdown)) return markdown
    // Parse the tag structure on short values, including unquoted src attributes.
    const candidates: string[] = []
    const prefix = 'am-' + crypto.randomUUID() + '-'
    const masked = markdown.replace(dataUrl, (src) => {
      if (src.length < minimumDataUrlLength) return src
      candidates.push(src)
      return prefix + candidates.length
    })
    if (!candidates.length) return markdown
    const videos = new Set(findEmbeddedMedia(masked).filter(m => m.kind === 'video' && m.preview).map(m => m.src))
    return masked.replace(new RegExp(prefix + '(\\d+)', 'g'), (marker, index: string) => {
      const src = candidates[Number(index) - 1]
      return videos.has(marker) ? this.compactSource(src) : src
    })
  }

  expand(text: string): string {
    if (!this.attachments.size) return text
    return text.replace(reference, ref => this.attachments.get(ref)?.payload ?? ref)
  }

  wordCount(text: string) {
    return wordCount(this.attachments.size ? text.replace(reference, ref => this.attachments.has(ref) ? '' : ref) : text)
  }

  storedSource(src: string): string {
    if (src.length < minimumDataUrlLength || !/^data:video\//i.test(src)) return src
    const comma = src.indexOf(',') + 1
    const ref = this.references.get(src.slice(comma))
    return ref ? src.slice(0, comma) + ref : src
  }

  checkpoint(text: string, base: { markdown: string; revision: number } | null): { markdown: string; reuse?: ReusedContent } {
    if (!this.attachments.size || !base) return { markdown: this.expand(text) }
    const offsets = new Map<string, number[]>()
    let delta = 0
    for (const match of base.markdown.matchAll(reference)) {
      const ref = match[0]
      const item = this.attachments.get(ref)
      if (!item) continue
      const positions = offsets.get(ref) ?? []
      positions.push(match.index + delta)
      offsets.set(ref, positions)
      delta += item.payload.length - ref.length
    }
    const spans: ReusedContent['spans'] = []
    delta = 0
    const markdown = text.replace(reference, (ref, index: number) => {
      const item = this.attachments.get(ref)
      if (!item) return ref
      const from = offsets.get(ref)?.pop()
      if (from === undefined) {
        delta += item.payload.length - ref.length
        return item.payload
      }
      spans.push({ at: index + delta, from, length: item.payload.length })
      delta -= ref.length
      return ''
    })
    return spans.length ? { markdown, reuse: { revision: base.revision, spans } } : { markdown }
  }

  playback(src: string): string | undefined {
    const comma = src.indexOf(',')
    const item = this.attachments.get(src.slice(comma + 1))
    if (!item) return
    const mime = src.slice(5, src.indexOf(';'))
    let url = item.urls.get(mime)
    if (!url) {
      try {
        const bytes = Uint8Array.fromBase64(item.payload)
        url = URL.createObjectURL(new Blob([bytes], { type: mime }))
        item.urls.set(mime, url)
      } catch {
        return this.expand(src)
      }
    }
    return url
  }

  edit(image: IEmbeddedImageEdit): IEmbeddedImageEdit {
    if (image.kind !== 'video') return image
    const source = this.expand(image.src)
    const stored = (src: string) => src === source ? image.src : this.storedSource(src)
    return {
      ...image,
      src: source,
      matches: expected => image.matches(stored(expected)),
      apply: (next, expected = source) => {
        let value = next
        if (next === source) value = image.src
        else if (next !== null) value = this.compactSource(next)
        image.apply(value, stored(expected))
      }
    }
  }

  async viewKey(markdown: string): Promise<string> {
    // Saved selections must match after reopening the file with newly allocated references.
    if (!this.attachments.size) return markdown
    const digests = new Map<string, string>()
    for (const [ref] of markdown.matchAll(reference)) {
      const item = this.attachments.get(ref)
      if (item && !digests.has(ref)) {
        item.digest ??= getHash(item.payload, 'utf8', 'sha256')
        digests.set(ref, await item.digest)
      }
    }
    return markdown.replace(reference, ref => digests.has(ref) ? 'sha256:' + digests.get(ref) : ref)
  }

  dispose() {
    for (const item of this.attachments.values()) {
      for (const url of item.urls.values()) URL.revokeObjectURL(url)
    }
    this.attachments.clear()
    this.references.clear()
  }
}

const documents = new Map<string, VideoAttachments>()

export function documentVideos(id: string) {
  let videos = documents.get(id)
  if (!videos) {
    videos = new VideoAttachments()
    documents.set(id, videos)
  }
  return videos
}

export function releaseDocumentVideos(id: string) {
  documents.get(id)?.dispose()
  documents.delete(id)
}
