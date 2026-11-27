import { blankDrawing, isDrawingPath } from '../drawing'
import { SessionLifecycle } from '../types/applicationState'
import type {
  ApplicationState,
  DocumentSnapshot,
  TabBarMode,
  WindowLayoutState
} from '../types/applicationState'

export const resolveTabBarMode = (value: unknown): TabBarMode => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const tabBar = value as { visible?: unknown; mode?: unknown; hiddenByUser?: unknown }
    if (tabBar.mode === 'auto' || tabBar.mode === 'visible' || tabBar.mode === 'hidden')
      return tabBar.mode
    if (tabBar.visible !== true && tabBar.hiddenByUser === true) return 'hidden'
  }
  return 'auto'
}

export const serializeTabBarState = (mode: TabBarMode): WindowLayoutState['tabBar'] =>
  mode === 'visible'
    ? { visible: true, mode: 'visible' }
    : mode === 'hidden'
      ? { visible: false, mode: 'hidden' }
      : { visible: false }

export const normalizeTabBarState = (value: unknown): WindowLayoutState['tabBar'] =>
  serializeTabBarState(resolveTabBarMode(value))

export const emptyDocumentBody = ({
  resource,
  title
}: Pick<DocumentSnapshot, 'resource' | 'title'>): string =>
  resource.kind === 'untitled' && isDrawingPath(title) ? blankDrawing : ''

export const createDefaultLayout = (
  preferences: { sourceCodeModeEnabled: boolean } = { sourceCodeModeEnabled: false }
): WindowLayoutState => ({
  sidebar: {
    visible: false,
    activeView: 'files',
    preferredWidthPx: 280,
    openedFiles: { expanded: true, preferredHeightPx: 112 }
  },
  tabBar: { visible: false },
  modes: { sourceCode: preferences.sourceCodeModeEnabled, focus: false, typewriter: false }
})

export const createEmptyApplicationState = (
  sessionId: string,
  nowMs: number
): ApplicationState => ({
  schemaVersion: 1,
  revision: 0,
  updatedAtMs: nowMs,
  session: {
    id: sessionId,
    lifecycle: SessionLifecycle.RUNNING,
    windows: [],
    activeWindowId: null,
    lastWindow: null
  },
  lastActiveWorkspaceId: null,
  recentWorkspaces: [],
  recentEmptyWindowLayout: null
})
