import type { ThemeCaptureEvent } from './localTheme'

export interface ThemeCollaborationFiles {
  css: string
  sampleMarkdown: string
}

export type ThemeCollaborationIssue = { kind: 'css'; detail: string } | { kind: 'sample' | 'files' }

export interface ThemeCollaborationState extends ThemeCollaborationFiles {
  revision: number
  issue?: ThemeCollaborationIssue
}

export interface ThemeCollaborationConnection {
  id: string
  directory: string
  state: ThemeCollaborationState
}

export type ThemeCollaborationCapture = ThemeCaptureEvent & { sampleMarkdown: string }
