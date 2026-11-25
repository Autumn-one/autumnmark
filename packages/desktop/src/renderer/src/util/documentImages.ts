import { embeddedImageDestination, findDocumentImages } from '@muyajs/core'

export const isInlineImage = (src: string): boolean => /^data:image\//i.test(src)

export function imageDestinationEdits(markdown: string, converted: ReadonlyMap<string, string>) {
  return findDocumentImages(markdown).flatMap(image => {
    const data = converted.get(image.src)
    return data ? [{ start: image.start, end: image.end, text: embeddedImageDestination(image, data) }] : []
  })
}
