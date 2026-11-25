import fs from 'fs-extra'
import { type Stats } from 'fs'
import path from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import {
  isFile as commonIsFile,
  isDirectory as commonIsDirectory,
  isExecutableFile
} from 'common/filesystem'
import { hasMarkdownExtension } from 'common/filesystem/paths'
import type { SerializedStat } from '@shared/types/files'
import type { SidebarMoveRequest, SidebarMoveResult } from '@shared/types/project'
import { copyFileWithContentHash } from '../filesystem'
import { loadMarkdownFile, readMarkdownSource, writeMarkdownFile } from '../filesystem/markdown'
import { applyMarkdownEdits, type MarkdownEdit } from '@shared/markdownEdits'
import { listMediaDocuments, mediaFileKey } from '../filesystem/mediaDocuments'
import { isDrawingPath } from '@shared/drawing'
import { t } from '../i18n'

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  birthtimeMs: stats.birthtimeMs,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

export interface FileOperations {
  isDocumentOpen(pathname: string): Promise<boolean>
  move(sender: WebContents, src: string, dest: string, write: () => Promise<void>): Promise<void>
  moveInProject(sender: WebContents, request: SidebarMoveRequest): Promise<SidebarMoveResult>
}
export const registerFsHandlers = (operations?: FileOperations): void => {
  const updating = new Set<string>()
  ipcMain.handle('mt::drawing::write', async(_event, pathname: string, content: string, expected?: string) => {
    if (typeof pathname !== 'string' || !path.isAbsolute(pathname) || !isDrawingPath(pathname) ||
        typeof content !== 'string' || (expected !== undefined && typeof expected !== 'string'))
      throw new Error(t('drawing.invalidFile'))
    const target = await fs.realpath(pathname).catch(error => {
      if (expected !== undefined || error.code !== 'ENOENT') throw error
      return pathname
    })
    const key = process.platform === 'win32' ? target.toLowerCase() : target
    if (updating.has(key)) throw new Error(t('drawing.changedOnDisk'))
    updating.add(key)
    try {
      const opened = await operations?.isDocumentOpen(target)
      if (opened || (expected !== undefined && await fs.readFile(target, 'utf8') !== expected))
        throw new Error(t('drawing.changedOnDisk'))
      await writeMarkdownFile(target, content, { encoding: { encoding: 'utf8', isBom: false }, adjustLineEndingOnSave: false, lineEnding: 'lf' })
    } finally {
      updating.delete(key)
    }
  })
  ipcMain.handle('mt::media::list-documents', (_event, target: string, directory: boolean, excludes: string[], openPaths: string[]) =>
    listMediaDocuments(target, directory, excludes, openPaths))
  ipcMain.handle('mt::media::read-document', async(_event, pathname: string, guessEncoding: boolean) => {
    if (!hasMarkdownExtension(pathname)) throw new Error('Expected a Markdown document')
    const target = await fs.realpath(pathname)
    const key = mediaFileKey(await fs.stat(target, { bigint: true }), target)
    const source = await readMarkdownSource(target, guessEncoding, true)
    return { markdown: source.markdown, hash: key + '/' + source.rawBaseline.rawSha256 }
  })
  ipcMain.handle('mt::media::update-document', async(_event, pathname: string, guessEncoding: boolean, hash: string, edits: MarkdownEdit[]) => {
    if (!hasMarkdownExtension(pathname)) throw new Error('Expected a Markdown document')
    const target = await fs.realpath(pathname)
    const key = mediaFileKey(await fs.stat(target, { bigint: true }), target)
    if (updating.has(key)) return 'changed'
    updating.add(key)
    try {
      const opened = await operations?.isDocumentOpen(target)
      if (opened) return 'changed'
      const source = await readMarkdownSource(target, guessEncoding, true)
      if (key + '/' + source.rawBaseline.rawSha256 !== hash) return 'changed'
      const markdown = applyMarkdownEdits(source.markdown, edits)
      await writeMarkdownFile(target, markdown, { encoding: source.encoding, adjustLineEndingOnSave: false, lineEnding: 'lf' })
      return 'saved'
    } finally {
      updating.delete(key)
    }
  })
  ipcMain.handle('mt::read-heading-link-document', async(_event, pathname: string, guessEncoding: boolean) => {
    if (!hasMarkdownExtension(pathname) || !commonIsFile(pathname)) return null
    return (await loadMarkdownFile(pathname, 'lf', guessEncoding)).markdown
  })
  ipcMain.handle('mt::project-move-item', (event, request: SidebarMoveRequest) => {
    if (!operations) throw new Error('Project operations unavailable')
    return operations.moveInProject(event.sender, request)
  })
  ipcMain.handle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  ipcMain.handle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  ipcMain.handle('mt::fs::empty-dir', (_e, p: string) => fs.emptyDir(p))
  ipcMain.handle('mt::fs::copy', (_e, src: string, dest: string) => fs.copy(src, dest))
  ipcMain.handle('mt::fs::copy-with-content-hash', (_e, src: string, outputDir: string) =>
    copyFileWithContentHash(src, outputDir)
  )
  ipcMain.handle('mt::fs::ensure-dir', (_e, p: string) => fs.ensureDir(p))

  ipcMain.handle('mt::fs::output-file', (_e, p: string, data: unknown) =>
    fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::move', (event, src: string, dest: string) => {
    const move = () => fs.move(src, dest, { overwrite: false })
    if (operations) return operations.move(event.sender, src, dest, move)
    return move()
  })
  ipcMain.handle('mt::fs::stat', async(_e, p: string) => serializeStat(await fs.stat(p)))

  ipcMain.handle('mt::fs::write-file', (_e, p: string, data: unknown) =>
    fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::read-file', async(_e, p: string, encoding?: BufferEncoding) => {
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('mt::fs::unlink', (_e, p: string) => fs.unlink(p))
  ipcMain.handle('mt::fs::readdir', (_e, p: string) => fs.readdir(p))
  // The same predicate the main process spawns by, or the preferences panel
  // green-ticks a cliScript that then fails with EACCES.
  ipcMain.handle('mt::fs::is-executable', (_e, p: string) => isExecutableFile(p))
}
