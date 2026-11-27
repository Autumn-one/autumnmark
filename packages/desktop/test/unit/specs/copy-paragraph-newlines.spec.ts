import { describe, expect, it, vi } from 'vitest'
import schema from '@shared/preferences/schema.json'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'

vi.mock('electron', () => {
  class MockMenuItem {
    id?: string
    label?: string
    enabled?: boolean
    type?: string
    submenu?: unknown
    click?: unknown

    constructor(options: Record<string, unknown>) {
      Object.assign(this, options)
    }
  }

  class MockMenu {
    items: MockMenuItem[] = []
    append(item: MockMenuItem) {
      this.items.push(item)
    }
  }

  return {
    Menu: MockMenu,
    MenuItem: MockMenuItem,
    ipcMain: { on: vi.fn(), handle: vi.fn(), emit: vi.fn() },
    BrowserWindow: { fromWebContents: vi.fn() }
  }
})

vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key
}))

const { default: editTemplate } = await import('main_renderer/menu/templates/edit')
const { buildEditorContextMenu } = await import('main_renderer/contextMenu/editor')

describe('copyParagraphNewlines preference and shortcuts', () => {
  it('defaults to double newlines in preference schema', () => {
    expect(schema.copyParagraphNewlines.default).toBe('double')
    expect(schema.copyParagraphNewlines.enum).toEqual(['double', 'single'])
  })

  it('binds alternate newline copy to Ctrl/Command+Shift+C and unbinds copy-as-rich across platforms', () => {
    expect(keybindingsWindows.get('edit.copy-alternate-newlines')).toBe('Ctrl+Shift+C')
    expect(keybindingsWindows.get('edit.copy-as-rich')).toBe('')

    expect(keybindingsLinux.get('edit.copy-alternate-newlines')).toBe('Ctrl+Shift+C')
    expect(keybindingsLinux.get('edit.copy-as-rich')).toBe('')

    expect(keybindingsDarwin.get('edit.copy-alternate-newlines')).toBe('Command+Shift+C')
    expect(keybindingsDarwin.get('edit.copy-as-rich')).toBe('')
  })

  it('switches the Edit menu alternate copy label based on copyParagraphNewlines', () => {
    const fakeKeybindings = {
      getAccelerator: (id: string) => (id === 'edit.copy-alternate-newlines' ? 'Ctrl+Shift+C' : null)
    } as never

    const doubleMenu = editTemplate(fakeKeybindings, { getItem: () => 'double' } as never)
    const doubleItem = (doubleMenu.submenu as Array<{ id?: string; label?: string; accelerator?: string }>)
      .find(item => item.id === 'copyAlternateNewlinesMenuItem')
    expect(doubleItem?.label).toBe('menu.edit.copyAsSingleNewline')
    expect(doubleItem?.accelerator).toBe('Ctrl+Shift+C')

    const singleMenu = editTemplate(fakeKeybindings, { getItem: () => 'single' } as never)
    const singleItem = (singleMenu.submenu as Array<{ id?: string; label?: string }>)
      .find(item => item.id === 'copyAlternateNewlinesMenuItem')
    expect(singleItem?.label).toBe('menu.edit.copyAsStandardMarkdown')
  })

  it('includes copyAlternateNewlinesMenuItem in the editor context menu with selection gating', () => {
    const enabledMenu = buildEditorContextMenu('hello', false, true, undefined, undefined, 'double')
    const enabledItem = enabledMenu.items.find(item => item.id === 'copyAlternateNewlinesMenuItem')
    expect(enabledItem?.label).toBe('contextMenu.copyAsSingleNewline')
    expect(enabledItem?.enabled).toBe(true)

    const disabledMenu = buildEditorContextMenu('', false, true, undefined, undefined, 'single')
    const disabledItem = disabledMenu.items.find(item => item.id === 'copyAlternateNewlinesMenuItem')
    expect(disabledItem?.label).toBe('contextMenu.copyAsStandardMarkdown')
    expect(disabledItem?.enabled).toBe(false)
  })
})
