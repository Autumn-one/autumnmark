import type { TDrawingInsertTrace } from '@muyajs/core'
import { shallowReactive, shallowRef } from 'vue'

export interface DrawingEditor {
  title: string
  source: string
  unsavedSource?: string
  pathname?: string
  noteId?: string
  embedded?: boolean
  embeddedIndex?: number
  readOnly: boolean
  draft: boolean
  nameOnInsert?: boolean
  filename?: string
  dirtyDraft?: boolean
  insertionTrace?: TDrawingInsertTrace
  commit: (content: string, filename?: string) => Promise<boolean>
  save?: () => Promise<boolean>
  beforeClose?: (transactionId?: string) => Promise<boolean>
}

export const drawingEditorTabs = shallowReactive(new Map<string, DrawingEditor>())
export const drawingDialog = shallowRef<DrawingEditor | null>(null)

// Restoring a Markdown selection can focus the editor underneath the drawing dialog.
export function preserveDrawingFocus(update: () => void) {
  const focused = document.activeElement
  try {
    update()
  } finally {
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused &&
        (focused.closest('.drawing-workspace') || focused.closest('.el-dialog')?.querySelector('.drawing-workspace')))
      focused.focus({ preventScroll: true })
  }
}
