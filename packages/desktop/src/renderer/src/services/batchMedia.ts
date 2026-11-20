import { nextTick } from 'vue'
import { embeddedImageDestination, findLinkedDocumentMedia } from '@muyajs/core'
import { t } from '@/i18n'
import { getSessionActions, useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { embedVideo } from '@/util/video'
import { documentVideos } from '@/util/videoAttachments'
import { documentMediaSource, embedLinkedImage } from './pastedImages'
import type { MarkdownEdit } from '@shared/markdownEdits'

type Media = ReturnType<typeof findLinkedDocumentMedia>[number]
export type MediaSelection = Record<Media['kind'], boolean>
export type MediaEditor = (id: string, edits: (markdown: string) => MarkdownEdit[]) => void

export interface MediaDocument {
  pathname: string
  aliases: string[]
  media: Media[]
  origin: { tabId: string; markdown: string } | { hash: string }
}

function openTab(pathname: string) {
  return useEditorStore().tabs.find(tab => tab.pathname && window.fileUtils.isSamePathSync(tab.pathname, pathname))
}

export async function scanMediaDocument(paths: string[]): Promise<MediaDocument> {
  const open = useEditorStore().tabs.filter(tab => paths.some(path => window.fileUtils.isSamePathSync(path, tab.pathname)))
  if (open.length > 1) throw new Error(t('batchMedia.changed'))
  const tab = open[0]
  const pathname = tab?.pathname ?? paths[0]
  const aliases = paths.filter(path => path !== pathname)
  if (tab) {
    const media = findLinkedDocumentMedia(tab.markdown)
    if (media.length && (tab.readOnly || tab.modeChanging)) throw new Error(t('batchMedia.locked'))
    return { pathname, aliases, media, origin: { tabId: tab.id, markdown: tab.markdown } }
  }
  const { markdown, hash } = await window.electron.ipcRenderer.invoke(
    'mt::media::read-document', pathname, usePreferencesStore().autoGuessEncoding
  )
  return { pathname, aliases, media: findLinkedDocumentMedia(markdown), origin: { hash } }
}

async function readMedia(media: Media, doc: MediaDocument) {
  const src = documentMediaSource(media.src)
  const absolute = /^(?:https?|file):/i.test(src) || window.path.isAbsolute(src)
  const paths = absolute ? [doc.pathname] : [doc.pathname, ...doc.aliases]
  for (const [index, path] of paths.entries()) {
    try {
      if (media.kind === 'image') return await embedLinkedImage(media.src, path)
      return await embedVideo(absolute ? src : window.path.resolve(window.path.dirname(path), src))
    } catch (error) {
      if (index === paths.length - 1) throw error
    }
  }
  throw new Error('Missing document path')
}

export async function convertMediaDocument(
  doc: MediaDocument,
  selection: MediaSelection,
  edit: MediaEditor,
  report: (detail: string) => void
): Promise<number> {
  const sources = doc.media.filter(media => selection[media.kind])
  const data = { image: new Map<string, string>(), video: new Map<string, string>() }
  const attempted = { image: new Set<string>(), video: new Set<string>() }
  for (const media of sources) {
    if (attempted[media.kind].has(media.src)) continue
    attempted[media.kind].add(media.src)
    try {
      const value = await readMedia(media, doc)
      data[media.kind].set(media.src, value)
    } catch (error) {
      report(media.src + ' — ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  function edits(media: Media[]) {
    return media.flatMap(item => {
      const value = data[item.kind].get(item.src)
      return value ? [{ start: item.start, end: item.end, text: embeddedImageDestination(item, value) }] : []
    })
  }
  const count = sources.filter(item => data[item.kind].has(item.src)).length
  if (!count) return 0
  const { pathname, origin } = doc
  const tab = openTab(pathname)
  const changed = () => new Error(t('batchMedia.changed'))
  if ('hash' in origin) {
    if (tab) throw changed()
    const status = await window.electron.ipcRenderer.invoke(
      'mt::media::update-document', pathname, usePreferencesStore().autoGuessEncoding, origin.hash, edits(sources)
    )
    if (status !== 'saved') throw changed()
    return count
  }

  const store = useEditorStore()
  store.flushActiveEditor()
  if (!tab || tab.id !== origin.tabId || tab.markdown !== origin.markdown || tab.readOnly || tab.modeChanging) throw changed()
  const wasSaved = tab.isSaved && !tab.isPendingCreation
  const previous = store.currentFile
  try {
    // Inactive tabs also need their editor's undo history and video attachment table.
    if (previous?.id !== tab.id) {
      store.UPDATE_CURRENT_FILE(tab)
      await nextTick()
    }
    if (store.currentFile?.id !== tab.id || tab.readOnly || tab.modeChanging || tab.pathname !== pathname) throw changed()
    const videos = documentVideos(tab.id)
    for (const [src, value] of data.video) data.video.set(src, videos.compactSource(value))
    edit(tab.id, markdown => {
      const live = findLinkedDocumentMedia(markdown)
      const replacements = edits(live)
      if (replacements.length !== count) throw changed()
      return replacements
    })
    store.flushActiveEditor()
  } finally {
    if (previous && previous.id !== tab.id && store.currentFile?.id === tab.id && store.tabs.includes(previous)) {
      store.UPDATE_CURRENT_FILE(previous)
    }
  }
  if (wasSaved) {
    const result = await getSessionActions()?.save(tab.id)
    if (result?.status !== 'saved') throw new Error(t('batchMedia.saveFailed'))
  }
  return count
}
