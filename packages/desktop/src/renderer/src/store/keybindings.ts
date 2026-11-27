import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import log from 'electron-log'
import { setKeyboardLayout } from 'common/localShortcut'
import COMMANDS from 'common/commands/constants'
import { i18n, t } from '@/i18n'
import notice from '@/services/notification'
import KeybindingConfigurator, { type UiKeybinding } from '@/prefComponents/keybindings/KeybindingConfigurator'
import { usePreferencesStore } from './preferences'

export const useKeybindingsStore = defineStore('preference-keybindings', () => {
  const preferences = usePreferencesStore()
  const configurator = shallowRef<KeybindingConfigurator | null>(null)
  const commands = shallowRef<UiKeybinding[]>([])
  const hasCustomBindings = computed(() => commands.value.some(command => command.accelerator !== command.defaultAccelerator))
  const loading = ref(false)
  const loadError = ref(false)
  const saving = ref(false)
  const conflict = shallowRef<{ accelerator: string; commands: UiKeybinding[] } | null>(null)
  let pending: Promise<void> | undefined

  const describeEntry = (entry: UiKeybinding): UiKeybinding => {
    if (entry.id !== COMMANDS.EDIT_COPY_ALTERNATE_NEWLINES) return { ...entry }
    const key = preferences.copyParagraphNewlines === 'single'
      ? 'menu.edit.copyAsStandardMarkdown'
      : 'menu.edit.copyAsSingleNewline'
    return { ...entry, description: t(key) }
  }

  const refresh = (): void => {
    commands.value = configurator.value?.rebuildKeybindingList().map(describeEntry) ?? []
  }
  watch(i18n.global.locale, refresh)
  watch(() => preferences.copyParagraphNewlines, refresh)

  const ensureLoaded = async(): Promise<void> => {
    if (configurator.value) return
    if (pending) return pending
    loading.value = true
    loadError.value = false
    pending = (async() => {
      try {
        const keyboard = window.electron.ipcRenderer.invoke('mt::keybinding-get-keyboard-info')
          .catch(error => { log.error(error); return null })
        const [layout, bindings] = await Promise.all([
          keyboard,
          window.electron.ipcRenderer.invoke('mt::keybinding-get-pref-keybindings')
        ])
        if (layout) setKeyboardLayout(layout.layout, layout.keymap)
        configurator.value = new KeybindingConfigurator(bindings.defaultKeybindings, bindings.userKeybindings)
        refresh()
      } catch (error) {
        loadError.value = true
        log.error(error)
      } finally {
        loading.value = false
        pending = undefined
      }
    })()
    return pending
  }

  const persist = async(operation: (config: KeybindingConfigurator) => Promise<boolean>): Promise<void> => {
    const config = configurator.value
    if (!config || saving.value) return
    const before = config.getKeybindings().map(entry => ({ ...entry }))
    const wasDirty = config.isDirty
    conflict.value = null
    saving.value = true
    try {
      const saved = await operation(config)
      if (!saved) throw new Error('Keybinding save was rejected')
    } catch (error) {
      config.keybindingList = before
      config.isDirty = wasDirty
      log.error(error)
      notice.notify({
        title: t('preferences.keybindings.failedToSave'),
        type: 'error',
        message: t('preferences.keybindings.saveError')
      })
    } finally {
      refresh()
      saving.value = false
    }
  }

  const change = async(id: string, accelerator: string): Promise<void> => {
    const config = configurator.value
    if (!config || saving.value) return
    conflict.value = null
    const occupied = config.getConflicts(id, accelerator)
    if (occupied.length > 0) {
      conflict.value = { accelerator, commands: occupied.map(command => ({ ...command })) }
      return
    }
    await persist(async(current) => {
      const changed = current.change(id, accelerator)
      if (!changed) return false
      return current.save()
    })
  }
  const reset = async(id: string): Promise<void> => {
    const accelerator = configurator.value?.getDefaultAccelerator(id)
    if (accelerator !== undefined) await change(id, accelerator)
  }
  const unbind = async(id: string): Promise<void> => { await change(id, '') }
  const resetAll = async(): Promise<void> => { await persist(current => current.resetAll()) }

  return { commands, hasCustomBindings, loading, loadError, saving, conflict, ensureLoaded, change, reset, unbind, resetAll }
})
