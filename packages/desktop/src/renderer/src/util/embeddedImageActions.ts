import {
  type IEmbeddedImageEdit,
  findEmbeddedMedia,
  getClipboardImageFile,
  standaloneImageSource
} from '@muyajs/core'
import {
  pickVideo,
  videoFile,
  videoData,
  videoSource,
  videoPlaybackUrl,
  videoTransferSource,
  savedVideoDocument,
  isVideoData,
  validateVideo
} from './video'
import { embeddedImageExtension, embeddedImageFilename } from '@shared/embeddedImage'
import { popupContextMenu } from '@/contextMenu/popupMenu'
import { t } from '@/i18n'
import notice from '@/services/notification'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { useProjectStore } from '@/store/project'
import { copyImageToClipboard, rasterizeImage } from './clipboard'
import { dataURLToFile } from './dataURLToFile'
import { embedImage, isEmbeddedImageUrl, readClipboardImage } from './embedImage'
import { moveImageToFolder } from './fileSystem'
import { documentVideos } from './videoAttachments'

export type EmbeddedTab = 'preview' | 'source'

export function imageFromTransfer(data: DataTransfer | null) {
  if (!data) return null
  const text = data.getData('text/plain').trim()
  return (
    getClipboardImageFile(data) ??
    standaloneImageSource(data.getData('text/html'), data.getData('text/uri-list') || text) ??
    (isEmbeddedImageUrl(text) ? text : null)
  )
}

export async function validatedSource(input: string | File, kind?: 'video', expected = '') {
  if (kind === 'video') {
    const src = await videoSource(
      input,
      isVideoData(expected) || usePreferencesStore().embedVideos,
      savedVideoDocument(useEditorStore().currentFile)
    )
    if (src) await validateVideo(src)
    return src.replace(/&(?!(?:amp|quot|lt|gt);)/g, '&amp;').replace(/"/g, '&quot;')
  }
  const src = await embedImage(input, useEditorStore().currentFile?.pathname)
  if (!isEmbeddedImageUrl(src)) throw new Error(t('embeddedImage.invalid'))
  const image = new Image()
  image.src = src
  await image.decode()
  return src
}

function originalImage(src: string) {
  const file = dataURLToFile(src)
  if (!file) throw new Error(t('embeddedImage.invalid'))
  return file
}

async function imageBytes(src: string, mime: 'image/jpeg' | 'image/png') {
  if (src.slice(5, src.indexOf(';')).toLowerCase() === mime) {
    return new Uint8Array(await originalImage(src).arrayBuffer())
  }
  return rasterizeImage(src, mime)
}

export function reportImageError(error: unknown, kind?: 'video') {
  void notice
    .notify({
      type: 'error',
      title: t(kind === 'video' ? 'video.title' : 'embeddedImage.title'),
      message: String(error)
    })
    .catch(() => {})
}

export function dragOriginal(src: string, name: string, kind?: 'video') {
  const data = kind === 'video' ? videoTransferSource(src) : Promise.resolve(src)
  void data
    .then((value) =>
      window.electron.webUtils.dragEmbeddedImage(value, name || fallbackName(src, kind))
    )
    .catch((error) => reportImageError(error, kind))
}

function fallbackName(src: string, kind?: 'video') {
  const tab = useEditorStore().currentFile
  const stem = (tab?.filename ?? 'document').replace(/\.[^.]+$/, '')
  const images = findEmbeddedMedia(tab?.markdown ?? '').filter((media) => media.kind === kind)
  const reference = tab && kind === 'video' ? documentVideos(tab.id).storedSource(src) : src
  const ordinal = Math.max(1, images.findIndex((image) => image.src === reference || image.src === src) + 1)
  return `${stem}-${kind || 'image'}-${String(ordinal).padStart(2, '0')}`
}

export async function copySource(src: string) {
  const written = await window.electron.clipboard.writeText(src)
  if (!written) throw new Error(t('embeddedImage.copyFailed'))
}

export async function saveImage(image: Pick<IEmbeddedImageEdit, 'src' | 'name' | 'kind'>) {
  const video = image.kind === 'video'
  const src = video ? image.src : await embedImage(image.src)
  const file = video ? await videoFile(videoPlaybackUrl(src)) : originalImage(src)
  const ext = embeddedImageExtension(file.type)
  const formats = video ? [ext] : [...new Set([ext, 'png', 'jpg'])]
  const path = await window.electron.dialog.showSave({
    title: t(video ? 'video.saveAs' : 'embeddedImage.saveAs'),
    defaultPath: embeddedImageFilename(
      image.name || fallbackName(image.src, image.kind),
      file.type
    ),
    filters: formats.map((format) => ({
      name: format.toUpperCase(),
      extensions: format === 'jpg' ? ['jpg', 'jpeg'] : [format]
    }))
  })
  if (!path) return
  const suffix = window.path
    .extname(path)
    .slice(1)
    .toLowerCase()
    .replace(/^jpeg$/, 'jpg')
  let bytes: Uint8Array
  if (suffix === ext) bytes = new Uint8Array(await file.arrayBuffer())
  else if (!video && (suffix === 'png' || suffix === 'jpg'))
    bytes = await imageBytes(src, suffix === 'jpg' ? 'image/jpeg' : 'image/png')
  else throw new Error(t('embeddedImage.unsupported'))
  await window.fileUtils.writeFile(path, bytes)
}

async function convertImage(image: IEmbeddedImageEdit, current: () => boolean) {
  const store = useEditorStore()
  if (!store.currentFile?.pathname || store.currentFile.isPendingCreation) {
    await store.FILE_SAVE({ waitForResult: true })
  }
  const tab = store.currentFile
  if (!current() || !tab?.pathname || tab.isPendingCreation) return
  const prefs = usePreferencesStore()
  const directory = window.path.dirname(tab.pathname)
  const root =
    prefs.imageRelativeDirectoryBase === 'file'
      ? directory
      : useProjectStore().ROOT_BASE(tab.pathname) || directory
  const folder = (prefs.imageRelativeDirectoryName || 'assets').replace(
    /\$\{filename\}/g,
    tab.filename.replace(/\.[^.]+$/, '')
  )
  const file = image.kind === 'video' ? await videoFile(image.src) : originalImage(image.src)
  const asset = new File([file], embeddedImageFilename(image.kind || 'image', file.type), {
    type: file.type
  })
  const relative = await moveImageToFolder(
    tab.pathname,
    asset,
    window.path.resolve(root, folder),
    true,
    tab.pathname
  )
  if (!current()) return
  const reference = relative
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/')
  image.apply(reference)
}

export async function showImageMenu(
  image: IEmbeddedImageEdit,
  event: MouseEvent,
  open: (tab: EmbeddedTab) => void
) {
  const store = useEditorStore()
  const tabId = store.currentFile?.id
  const current = () =>
    store.currentFile?.id === tabId &&
    !!store.currentFile?.readOnly === image.readOnly &&
    image.matches(image.src)
  const video = image.kind === 'video'
  const label = (key: string) => t((video ? 'video.' : 'embeddedImage.') + key)
  const { clientX: x, clientY: y } = event
  const canPaste =
    !image.readOnly && (await window.electron.clipboard.hasImage(image.kind).catch(() => false))
  if (!current()) return
  const action = (operation: () => void | Promise<void>) => async() => {
    if (!current()) return
    try {
      await operation()
    } catch (error) {
      reportImageError(error, image.kind)
    }
  }
  const copy = async(mime: 'image/jpeg' | 'image/png') => {
    const written = await copyImageToClipboard(
      () => imageBytes(image.src, mime),
      undefined,
      current,
      mime
    )
    if (!written && current()) throw new Error(t('embeddedImage.copyFailed'))
  }
  const replace = async(input?: File | string) => {
    if (!input) return
    const src = await validatedSource(input, image.kind, image.src)
    if (src && current() && src !== image.src) image.apply(src)
  }
  popupContextMenu(
    [
      {
        id: 'copyEmbedded',
        label: video ? t('video.copy') : t('editor.mediaViewer.copyImage'),
        click: action(async() => {
          if (!video) {
            await copy('image/png')
            return
          }
          const data = await videoTransferSource(image.src)
          if (current())
            await window.electron.ipcRenderer.invoke(
              'mt::video::copy-file',
              data,
              image.name || fallbackName(image.src, image.kind)
            )
        })
      },
      ...(video
        ? [
          {
            label: 'Base64 Data URL',
            click: action(async() => copySource(await videoData(videoPlaybackUrl(image.src))))
          }
        ]
        : [
          {
            label: t('embeddedImage.copyAs'),
            submenu: [
              { label: t('embeddedImage.jpeg'), click: action(() => copy('image/jpeg')) },
              { label: 'Base64 Data URL', click: action(() => copySource(image.src)) }
            ]
          }
        ]),
      { label: label('saveAs'), click: action(() => saveImage(image)) },
      {
        label: video && !isVideoData(image.src) ? t('video.toEmbedded') : label('convert'),
        enabled: !image.readOnly,
        click: action(async() => {
          if (video && !isVideoData(image.src)) {
            const data = await videoData(videoPlaybackUrl(image.src))
            if (current()) image.apply(data)
          } else await convertImage(image, current)
        })
      },
      { type: 'separator' },
      ...(video ? [{ label: t('video.preview'), click: action(() => open('preview')) }] : []),
      {
        label: t(video && !isVideoData(image.src) ? 'video.location' : 'embeddedImage.viewSource'),
        click: action(() => open('source'))
      },
      {
        label: label('replace'),
        enabled: !image.readOnly,
        submenu: [
          {
            label: label('choose'),
            click: action(async() =>
              replace(await (video ? pickVideo() : store.ASK_FOR_IMAGE_PATH()))
            )
          },
          {
            label: label('fromClipboard'),
            enabled: canPaste,
            click: action(async() => replace(await readClipboardImage(image.kind)))
          }
        ]
      },
      { type: 'separator' },
      {
        label: label('delete'),
        enabled: !image.readOnly,
        click: action(() => image.apply(null))
      }
    ],
    { x, y }
  )
}
