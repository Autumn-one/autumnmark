import { Menu, MenuItem, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import {
  getCUT,
  getCOPY,
  getPASTE,
  getCopyAsRich,
  getCopyAsHtml,
  getPasteAsPlainText,
  getLookUp,
  SEPARATOR,
  getInsertBefore,
  getInsertAfter
} from './menuItems'
import spellcheckMenuBuilder from './spellcheck'
import { t } from '../../i18n'
import { isOsx } from '../../config'

interface ContextMenuParams {
  isEditable: boolean
  hasImageContents?: boolean
  selectionText: string
  inputFieldType?: string
  editFlags: {
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canEditRichly: boolean
  }
  misspelledWord?: string
  dictionarySuggestions?: string[]
  x: number
  y: number
}

const getContextItems = (): MenuItemConstructorOptions[] => [
  getInsertBefore(),
  getInsertAfter(),
  SEPARATOR,
  getCUT(),
  getCOPY(),
  getPASTE(),
  SEPARATOR,
  getCopyAsRich(),
  getCopyAsHtml(),
  getPasteAsPlainText()
]

const isInsideEditor = (params: ContextMenuParams): boolean => {
  const { isEditable, editFlags, inputFieldType } = params
  // WORKAROUND for Electron#32102: `params.spellcheckEnabled` is always false. Try to detect the editor container via other information.
  return isEditable && !inputFieldType && !!editFlags.canEditRichly
}

export const buildEditorContextMenu = (
  selectionText: string,
  spellcheckerEnabled: boolean,
  canCopy = true,
  misspelledWord?: string,
  dictionarySuggestions?: string[]
): Menu => {
  const menu = new Menu()
  const hasText = selectionText.trim().length > 0
  if (isOsx && hasText) {
    menu.append(new MenuItem(getLookUp(selectionText)))
    menu.append(new MenuItem(SEPARATOR))
  }
  if (spellcheckerEnabled) {
    // Electron's native context-menu event supplies spelling suggestions on Windows.
    const submenu = spellcheckMenuBuilder(!!selectionText && !!misspelledWord, misspelledWord, dictionarySuggestions)
    menu.append(new MenuItem({ label: t('contextMenu.spelling'), submenu: submenu as MenuItemConstructorOptions[] }))
    menu.append(new MenuItem(SEPARATOR))
  }
  const copyItemIds = new Set(['cutMenuItem', 'copyMenuItem', 'copyAsHtmlMenuItem', 'copyAsRichMenuItem'])
  for (const item of getContextItems()) {
    if (item.id && copyItemIds.has(item.id)) item.enabled = hasText && canCopy
    menu.append(new MenuItem(item))
  }
  return menu
}

export const showEditorContextMenu = (win: BrowserWindow, params: ContextMenuParams, spellcheckerEnabled: boolean): void => {
  if (!isInsideEditor(params) || params.hasImageContents) return
  const menu = buildEditorContextMenu(params.selectionText, spellcheckerEnabled,
    params.editFlags.canCut && params.editFlags.canCopy, params.misspelledWord, params.dictionarySuggestions)
  menu.append(new MenuItem(SEPARATOR))
  menu.append(new MenuItem({ label: t('drawing.insert'), click: () => win.webContents.send('mt::execute-command-by-id', 'drawing.insert') }))
  menu.popup({ window: win, x: params.x, y: params.y })
}
