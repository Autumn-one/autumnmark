import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ThemeCollaborationCapture, ThemeCollaborationConnection, ThemeCollaborationFiles, ThemeCollaborationState } from '@shared/themeCollaboration'

export function useThemeCollaboration(options: {
  files: () => ThemeCollaborationFiles
  baseCss: () => string
  valid: () => boolean
  update: (files: Partial<ThemeCollaborationFiles>) => void
  capture: (event: ThemeCollaborationCapture) => void
}) {
  const ipc = window.electron.ipcRenderer
  const connection = shallowRef<ThemeCollaborationConnection>()
  const opening = ref(false)
  const stopping = ref(false)
  const notice = ref('')
  const failure = ref(false)
  const directory = computed(() => connection.value?.directory ?? '')
  const issue = computed(() => connection.value?.state.issue)
  const earlyStates = new Map<string, ThemeCollaborationState>()
  let savedBase = ''
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  let writeTask: Promise<boolean> | undefined
  let disposed = false

  function receive(state: ThemeCollaborationState, ownWrite = false): void {
    const linked = connection.value
    if (!linked || state.revision <= linked.state.revision) return
    connection.value = { ...linked, state }
    if (ownWrite || state.issue) return
    const update: Partial<ThemeCollaborationFiles> = {}
    if (state.css !== linked.state.css) update.css = state.css
    if (state.sampleMarkdown !== linked.state.sampleMarkdown) update.sampleMarkdown = state.sampleMarkdown
    options.update(update)
  }

  async function start(draftId: string): Promise<void> {
    if (opening.value || connection.value || !options.valid()) return
    opening.value = true
    failure.value = false
    const files = options.files()
    const base = options.baseCss()
    try {
      const linked = await ipc.invoke('mt::theme::collaboration-start', draftId, files, base)
      if (disposed) {
        await ipc.invoke('mt::theme::collaboration-stop', linked.id)
        return
      }
      savedBase = base
      connection.value = linked
      if (!linked.state.issue) options.update({ css: linked.state.css, sampleMarkdown: linked.state.sampleMarkdown })
      const latest = earlyStates.get(linked.id)
      if (latest) receive(latest)
    } catch { failure.value = true }
    finally {
      opening.value = false
      earlyStates.clear()
    }
  }

  function scheduleWrite(): void {
    clearTimeout(writeTimer)
    const linked = connection.value
    if (disposed || writeTask || !linked || linked.state.issue || !options.valid()) return
    const { css, sampleMarkdown } = options.files()
    if (css === linked.state.css && sampleMarkdown === linked.state.sampleMarkdown && savedBase === options.baseCss()) return
    writeTimer = setTimeout(() => { void writeLatest() }, 180)
  }

  function writeLatest(): Promise<boolean> {
    if (writeTask) return writeTask
    const linked = connection.value
    if (!linked) return Promise.resolve(true)
    if (linked.state.issue || !options.valid()) return Promise.resolve(false)
    const base = options.baseCss()
    failure.value = false
    writeTask = ipc.invoke('mt::theme::collaboration-write', linked.id, linked.state.revision, options.files(), base)
      .then(result => {
        if (connection.value?.id !== linked.id) return false
        if (result.saved) savedBase = base
        receive(result.state, result.saved)
        return result.saved
      }).catch(() => {
        failure.value = true
        return false
      }).finally(() => {
        writeTask = undefined
        if (!failure.value) scheduleWrite()
      })
    return writeTask
  }

  async function flush(): Promise<boolean> {
    clearTimeout(writeTimer)
    await writeTask
    clearTimeout(writeTimer)
    return writeLatest()
  }

  async function stop(): Promise<void> {
    const linked = connection.value
    if (!linked || stopping.value) return
    stopping.value = true
    try {
      await flush()
      clearTimeout(writeTimer)
      await ipc.invoke('mt::theme::collaboration-stop', linked.id)
      connection.value = undefined
      failure.value = false
    } catch { failure.value = true }
    finally { stopping.value = false }
  }

  async function openDirectory(): Promise<void> {
    if (!directory.value) return
    notice.value = ''
    const error = await window.electron.shell.openPath(directory.value)
    if (error) notice.value = 'openError'
  }

  async function copyDirectory(): Promise<void> {
    if (!directory.value) return
    const copied = await window.electron.clipboard.writeText(directory.value)
    notice.value = copied ? 'copied' : 'copyError'
  }

  const unsubscribeState = ipc.on('mt::theme::collaboration-state', (_event, id, state) => {
    if (connection.value?.id === id) receive(state)
    else if (opening.value) earlyStates.set(id, state)
  })
  const unsubscribeCapture = ipc.on('mt::theme::collaboration-capture', (_event, id, event) => {
    if (connection.value?.id === id) options.capture(event)
  })
  watch([options.files, options.baseCss, connection], scheduleWrite)
  onBeforeUnmount(() => {
    disposed = true
    unsubscribeState()
    unsubscribeCapture()
    clearTimeout(writeTimer)
    const linked = connection.value
    if (linked) void ipc.invoke('mt::theme::collaboration-stop', linked.id).catch(() => {})
  })

  return { directory, opening, stopping, notice, failure, issue, start, stop, flush, openDirectory, copyDirectory }
}
