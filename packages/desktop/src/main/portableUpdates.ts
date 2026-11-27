import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, rmSync } from 'node:fs'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { promisify } from 'node:util'
import { app, net } from 'electron'
import log from 'electron-log'
import { GITHUB_REPO_URL } from '@shared/brand'
import type { UpdateProgress } from '@shared/types/ipc'
import { t } from './i18n'
import updateScript from './windowsPortableUpdate.ps1?raw'

interface PortableRelease {
  version: string
  archive: string
  checksum: string
}

export interface PortableDownload {
  directory: string
  archivePath: string
}

const execFileAsync = promisify(execFile)

export async function checkPortableUpdate(isNewer: (version: string) => boolean): Promise<PortableRelease | null> {
  const response = await net.fetch(`${GITHUB_REPO_URL}/releases/latest/download/SHA256SUMS.txt`, {
    credentials: 'omit',
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Release checksums returned HTTP ${response.status}`)

  const sums = await response.text()
  const match = /^([a-f0-9]{64}) {2}(autumnmark-win-x64-((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2})\.zip)\r?$/m.exec(sums)
  if (!match) throw new Error('The release has no Windows portable ZIP checksum')
  const [, checksum, archive, version] = match
  return isNewer(version) ? { version, archive, checksum } : null
}

export async function downloadPortableUpdate(
  release: PortableRelease,
  report: (progress: UpdateProgress) => void
): Promise<PortableDownload> {
  const directory = await mkdtemp(path.join(app.getPath('temp'), 'autumnmark-download-'))
  const archivePath = path.join(directory, release.archive)
  try {
    const url = `${GITHUB_REPO_URL}/releases/download/v${release.version}/${release.archive}`
    const response = await net.fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(60 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Portable ZIP returned HTTP ${response.status}`)

    const total = Number(response.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    let transferred = 0
    let lastReport = performance.now()
    let lastTransferred = 0
    const track = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        transferred += chunk.length
        const now = performance.now()
        const elapsed = now - lastReport
        if (elapsed >= 250 || transferred === total) {
          const bytesPerSecond = elapsed > 0 ? (transferred - lastTransferred) * 1000 / elapsed : 0
          report({ transferred, total, bytesPerSecond })
          lastTransferred = transferred
          lastReport = now
        }
        callback(null, chunk)
      }
    })
    await pipeline(response.body, track, createWriteStream(archivePath, { flags: 'wx' }))
    if (hash.digest('hex') !== release.checksum) throw new Error('Portable ZIP checksum mismatch')
    return { directory, archivePath }
  } catch (error) {
    discardPortableFiles(directory)
    throw error
  }
}

export function discardPortableFiles(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    log.warn('Portable update cleanup failed:', error)
  }
}

export async function preparePortableInstall(download: PortableDownload) {
  const root = await realpath(path.dirname(process.execPath))
  const directory = await mkdtemp(path.join(root, '.autumnmark-update-'))
  const script = path.join(directory, 'update.ps1')
  const options = { cwd: root, windowsHide: true }
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
  try {
    await writeFile(script, updateScript, { flag: 'wx' })
    const userData = await realpath(app.getPath('userData'))
    await writeFile(path.join(directory, 'update.json'), JSON.stringify({
      archive: download.archivePath,
      executable: path.basename(process.execPath),
      parentPid: process.pid,
      userData,
      restartArgs: `--user-data-dir "${userData.replace(/\\+$/, '$&$&')}"`,
      failureMessage: t('updates.installFailed'),
      title: t('updates.title')
    }), { flag: 'wx' })
    await execFileAsync(powershell, args, options)
    return {
      cancel: () => discardPortableFiles(directory),
      apply: () => {
        // The helper waits for this process to exit before releasing Windows file locks.
        const child = spawn(powershell, [...args, '-Apply'], { ...options, detached: true, stdio: 'ignore' })
        child.once('error', error => log.warn('Could not launch the portable updater:', error))
        child.unref()
      }
    }
  } catch (error) {
    discardPortableFiles(directory)
    throw error
  }
}
