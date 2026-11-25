import { nextTick } from 'vue'
import { maxSkillMarkdownLength, type SkillDocument } from '@shared/autumnmarkSkill'
import { isDrawingPath } from '@shared/drawing'
import type { EditMarkdown } from '@shared/markdownEdits'
import { textChanges } from '@shared/reversibleText'
import type { IFileState } from '@shared/types/files'
import type { useEditorStore } from '@/store/editor'
import { builtinThemeCss } from '@/util/builtinTheme'
import { documentVideos } from '@/util/videoAttachments'
import { listenForSkillRequests, measureTheme, skillRevision } from './autumnmarkSkill'

function editable(tab: IFileState): boolean {
  return !tab.readOnly && !tab.modeChanging && !tab.diskConflict && !tab.diskMissing
}

export function serveSkillDocuments(
  editor: ReturnType<typeof useEditorStore>,
  readMarkdown: (id: string) => string | undefined,
  editMarkdown: EditMarkdown,
  getRenderedThemeState: () => string
): () => void {
  const documents = () => editor.tabs.filter(tab => !isDrawingPath(tab.pathname || tab.filename))

  return listenForSkillRequests(async request => {
    if (request.action === 'documents') {
      return documents().map((tab): SkillDocument => ({
        id: tab.id, name: tab.filename, path: tab.pathname, editable: editable(tab), active: tab.id === editor.currentFile?.id
      }))
    }
    if (request.action === 'active-theme') {
      await nextTick()
      const rendered = getRenderedThemeState()
      const revision = await skillRevision(rendered)
      if (revision !== request.revision || rendered !== getRenderedThemeState()) throw new Error('theme-target-changed')
      if (!request.query) return
      if ('base' in request.query) return builtinThemeCss(request.query.base)
      return measureTheme(document, request.query.probe)
    }
    if (request.action !== 'read-document' && request.action !== 'edit-document') throw new Error('invalid-request')
    const tab = documents().find(document => document.id === request.id)
    if (!tab || !editable(tab)) throw new Error('document-unavailable')

    editor.flushActiveEditor()
    const attachments = documentVideos(tab.id)
    const before = attachments.expand(readMarkdown(tab.id) ?? tab.markdown)
    if (before.length > maxSkillMarkdownLength) throw new Error('document-too-large')
    const revision = await skillRevision(before)
    if (request.action === 'read-document') return { markdown: before, revision }
    if (revision !== request.revision) throw new Error('document-changed')

    const previous = editor.currentFile
    if (previous?.id !== tab.id) {
      editor.UPDATE_CURRENT_FILE(tab)
      await nextTick()
    }
    try {
      if (!editable(tab) || editor.currentFile?.id !== tab.id) throw new Error('document-unavailable')
      editMarkdown(tab.id, live => {
        if (attachments.expand(live) !== before) throw new Error('document-changed')
        return textChanges(live, attachments.compact(request.markdown))
      })
      return { changed: request.markdown !== before }
    } finally {
      if (previous && previous.id !== tab.id && editor.currentFile?.id === tab.id &&
        editor.tabs.some(candidate => candidate.id === previous.id)) {
        editor.UPDATE_CURRENT_FILE(previous)
      }
    }
  })
}
