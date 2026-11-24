import type { SkillThemeMeasurement, SkillThemeProbe, SkillWindowRequest } from '@shared/autumnmarkSkill'

export function listenForSkillRequests(handle: (request: SkillWindowRequest) => unknown): () => void {
  const ipc = window.electron.ipcRenderer
  return ipc.on('mt::autumnmark-skill::request', async(_event, id, request) => {
    try {
      const value = await handle(request)
      ipc.send('mt::autumnmark-skill::response', id, { ok: true, value })
    } catch (error) {
      ipc.send('mt::autumnmark-skill::response', id, {
        ok: false, error: error instanceof Error ? error.message : 'operation-failed'
      })
    }
  })
}

export async function skillRevision(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function measureTheme(document: Document, probe: SkillThemeProbe): SkillThemeMeasurement {
  const view = document.defaultView
  if (!view) throw new Error('theme-preview-unavailable')
  let elements
  try { elements = document.querySelectorAll(probe.selector) } catch { throw new Error('invalid-selector') }
  const node = elements.item(probe.occurrence - 1)
  if (!node) return { matches: elements.length, value: null, visible: false }
  const style = view.getComputedStyle(node)
  return {
    matches: elements.length,
    value: style.getPropertyValue(probe.property).trim(),
    visible: node.getClientRects().length > 0 && style.visibility === 'visible'
  }
}
