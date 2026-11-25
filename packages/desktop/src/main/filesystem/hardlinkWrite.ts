import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdtemp, open, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

const writing = new Set<string>()

async function overwrite(handle: FileHandle, source: string) {
  let position = 0
  for await (const chunk of createReadStream(source)) {
    let offset = 0
    while (offset < chunk.length) {
      const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, position)
      if (!bytesWritten) throw new Error('Could not finish writing the document')
      position += bytesWritten
      offset += bytesWritten
    }
  }
  await handle.truncate(position)
  await handle.sync()
}

/** Replacing one directory entry atomically would sever every other name for the same document. */
export async function writePreservingHardlinks(pathname: string, write: (target: string) => Promise<void>) {
  const original = await stat(pathname, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!original || original.nlink < 2n) return write(pathname)
  const key = original.dev + ':' + original.ino
  if (writing.has(key)) throw new Error('Another save is updating this document')
  writing.add(key)
  let temporary: string | undefined
  let preserveBackup = false
  try {
    temporary = await mkdtemp(path.join(path.dirname(pathname), '.autumnmark-save-'))
    const staged = path.join(temporary, 'new')
    const backup = path.join(temporary, 'original')
    await write(staged)
    await copyFile(pathname, backup, constants.COPYFILE_FICLONE)
    const saved = await open(backup, 'r+')
    try {
      await saved.sync()
    } finally {
      await saved.close()
    }
    const target = await open(pathname, 'r+')
    try {
      const current = await target.stat({ bigint: true })
      if (original.dev !== current.dev || original.ino !== current.ino || original.ctimeNs !== current.ctimeNs)
        throw new Error('Document changed during save')
      try {
        await overwrite(target, staged)
      } catch (error) {
        try {
          await overwrite(target, backup)
        } catch (restoreError) {
          preserveBackup = true
          throw new AggregateError([error, restoreError], 'Could not restore document. Original saved at ' + backup, { cause: restoreError })
        }
        throw error
      }
    } finally {
      await target.close()
    }
  } finally {
    writing.delete(key)
    if (temporary && !preserveBackup) await rm(temporary, { recursive: true, force: true })
  }
}
