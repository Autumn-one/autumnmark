import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { checkPathExcludePattern, containsPath, hasMarkdownExtension } from 'common/filesystem/paths'

export function mediaFileKey(info: { dev: bigint; ino: bigint }, resolved: string) {
  return info.ino ? info.dev + ':' + info.ino : resolved
}

export async function listMediaDocuments(target: string, directory: boolean, excludes: readonly string[], openPaths: readonly string[] = []) {
  const root = await realpath(target)
  const rootInfo = await stat(root)
  if (directory ? !rootInfo.isDirectory() : !rootInfo.isFile()) throw new Error('The selected path has changed')
  const pending = [root]
  const directories = new Set<string>()
  const files = new Map<string, Set<string>>()
  const issues: string[] = []
  for (let index = 0; index < pending.length; index++) {
    const pathname = pending[index]
    try {
      const resolved = await realpath(pathname)
      if (!containsPath(root, resolved) || (resolved !== root && checkPathExcludePattern(resolved, excludes))) continue
      const info = await stat(resolved, { bigint: true })
      if (!info.isDirectory() && !(info.isFile() && (hasMarkdownExtension(resolved) || !directory))) continue
      // realpath collapses junctions and symlinks. A hard link shares only the device and inode.
      const key = mediaFileKey(info, resolved)
      if (info.isFile()) {
        const names = files.get(key) ?? new Set<string>()
        names.add(resolved)
        files.set(key, names)
        continue
      }
      if (directories.has(key)) continue
      directories.add(key)
      const entries = await readdir(resolved, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.endsWith('.asar')) continue
        if (!entry.isDirectory() && !entry.isSymbolicLink() && !hasMarkdownExtension(entry.name)) continue
        const child = path.join(resolved, entry.name)
        if (!checkPathExcludePattern(child, excludes)) pending.push(child)
      }
    } catch (error) {
      issues.push(pathname + ' — ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // An open buffer can use a different hard link or a path through a symlinked directory.
  for (const pathname of openPaths) {
    try {
      const resolved = await realpath(pathname)
      const info = await stat(resolved, { bigint: true })
      files.get(mediaFileKey(info, resolved))?.add(pathname)
    } catch {
      // Untitled, moved and pending-creation tabs need no disk match.
    }
  }
  return { files: Array.from(files.values(), names => [...names]), issues }
}
