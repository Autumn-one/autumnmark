// @vitest-environment node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPortableUpdate, downloadPortableUpdate } from '../../../src/main/portableUpdates'
import updateScript from '../../../src/main/windowsPortableUpdate.ps1?raw'

const net = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net, app: { getPath: () => temp } }))
vi.mock('../../../src/main/i18n', () => ({ t: (key: string) => key }))

const exec = promisify(execFile)
const expectedArchive = 'autumnmark-win-x64-0.25.0.zip'
const content = Buffer.from('portable archive')
const checksum = createHash('sha256').update(content).digest('hex')
let temp: string

beforeEach(async() => {
  net.fetch.mockReset()
  temp = await mkdtemp(path.join(os.tmpdir(), 'autumnmark-portable-test-'))
})

afterEach(async() => {
  await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
})

describe('Windows portable releases', () => {
  it('finds only the ZIP for the Windows portable edition and checks its version', async() => {
    const sums = `${checksum}  ${expectedArchive.replace('.zip', '-setup.exe')}\r\n${checksum}  ${expectedArchive}\r\n`
    const isNewer = vi.fn(() => true)
    net.fetch.mockResolvedValueOnce(new Response(sums)).mockResolvedValueOnce(new Response(sums))
    expect(await checkPortableUpdate(isNewer)).toEqual({ version: '0.25.0', archive: expectedArchive, checksum })
    expect(isNewer).toHaveBeenCalledWith('0.25.0')
    expect(await checkPortableUpdate(() => false)).toBeNull()
  })

  it('requires a matching checksum before passing the archive to the installer', async() => {
    const release = { version: '0.25.0', archive: expectedArchive, checksum }
    const report = vi.fn()
    net.fetch.mockResolvedValueOnce(new Response(content, { headers: { 'Content-Length': String(content.length) } }))
    net.fetch.mockResolvedValueOnce(new Response('corrupt archive'))
    const { archivePath } = await downloadPortableUpdate(release, report)
    expect(await readFile(archivePath)).toEqual(content)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ transferred: content.length, total: content.length }))
    expect(net.fetch).toHaveBeenCalledWith(expect.stringContaining(`/releases/download/v0.25.0/${expectedArchive}`), expect.anything())
    await expect(downloadPortableUpdate(release, report)).rejects.toThrow('checksum mismatch')
  })
})

describe.skipIf(process.platform !== 'win32')('portable Windows replacement', () => {
  it('replaces packaged files after exit and preserves the portable profile and documents', async() => {
    const root = path.join(temp, 'AutumnMark [便携版]')
    const userData = path.join(root, 'autumnmark-user-data')
    const documents = path.join(temp, 'documents')
    const replacement = path.join(temp, 'replacement')
    const workspace = path.join(root, '.autumnmark-update-fixture')
    const script = path.join(workspace, 'update.ps1')
    const archive = path.join(temp, expectedArchive)
    await Promise.all([
      mkdir(path.join(root, 'resources'), { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(documents),
      mkdir(path.join(replacement, 'resources'), { recursive: true }),
      mkdir(workspace, { recursive: true })
    ])
    await Promise.all([
      writeFile(path.join(root, 'resources', 'app.asar'), 'old version'),
      writeFile(path.join(root, 'resources', 'old-runtime-file'), 'obsolete'),
      writeFile(path.join(root, 'autumnmark.exe'), 'old executable'),
      writeFile(path.join(root, 'notes.md'), 'portable document'),
      writeFile(path.join(documents, 'linked.md'), 'linked document'),
      symlink(documents, path.join(root, 'resources', 'linked-documents'), 'junction'),
      writeFile(path.join(userData, 'preferences.json'), '{}'),
      writeFile(path.join(replacement, 'resources', 'app.asar'), 'new version'),
      copyFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'), path.join(replacement, 'autumnmark.exe')),
      writeFile(script, updateScript),
      writeFile(path.join(workspace, 'update.json'), JSON.stringify({
        archive, executable: 'autumnmark.exe', userData, parentPid: 2147483647, restartArgs: 'cmd.exe',
        failureMessage: 'Update failed', title: 'AutumnMark'
      }))
    ])
    const windows = process.env.SystemRoot ?? 'C:\\Windows'
    const powershell = path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const options = { cwd: root, windowsHide: true, timeout: 15_000 }
    await exec(path.join(windows, 'System32', 'tar.exe'), ['-a', '-c', '-f', archive, '-C', replacement, 'autumnmark.exe', 'resources'], options)
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
    await exec(powershell, args, options)
    expect(await readFile(path.join(root, 'resources', 'app.asar'), 'utf8')).toBe('old version')
    await exec(powershell, [...args, '-Apply'], options)
    expect(await readFile(path.join(root, 'resources', 'app.asar'), 'utf8')).toBe('new version')
    await expect(readFile(path.join(root, 'resources', 'old-runtime-file'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(root, 'notes.md'), 'utf8')).toBe('portable document')
    expect(await readFile(path.join(documents, 'linked.md'), 'utf8')).toBe('linked document')
    expect(await readFile(path.join(userData, 'preferences.json'), 'utf8')).toBe('{}')
  }, 30_000)
})
