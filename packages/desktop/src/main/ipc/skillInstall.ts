import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import writeAtomic from 'write-file-atomic'

// Older builds use this revision to avoid replacing a newer installed bundle.
const revision = 6
const bundledFiles = ['SKILL.md', 'bridge.cjs', 'theme-workspace.md'] as const
const runtimeFile = 'runtime.txt'
const files = [...bundledFiles, runtimeFile] as const
type SkillFile = (typeof files)[number]
type Hashes = Partial<Record<SkillFile, string>>
interface Manifest {
  revision: number
  hashes: Hashes
  previous?: Hashes
}

const legacy: Hashes = {
  'SKILL.md': '66456f05df5ced1503db32d3f7a57716c0e79ce983fad9447c8c03e35cb06e64',
  'bridge.cjs': '4af0758abb7857104155e20a728c532e38214ee40db953fe3be864e1ed9a83d9',
  'theme-workspace.md': 'f164e5d5f69e7ffb8c73d54c61d697b0144ecc2d5d698a35b9628f2d4e4f3ce4'
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code
const hash = (text: string): string => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')

async function read(path: string): Promise<string | undefined> {
  let stat
  try { stat = await lstat(path) } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('invalid-skill-file')
  return readFile(path, 'utf8')
}

function parseManifest(text: string | undefined): Manifest | undefined {
  if (!text) return undefined
  const value = JSON.parse(text) as Partial<Manifest> | null
  if (!value || !Number.isSafeInteger(value.revision) || !value.hashes || typeof value.hashes !== 'object') {
    throw new Error('invalid-skill-file')
  }
  return value as Manifest
}

export async function prepareAutumnMarkSkill(
  home: string, source: string, runtime: string
): Promise<'ready' | 'conflict'> {
  const directory = join(home, '.agents', 'skills', 'autumnmark')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (!(await lstat(directory)).isDirectory()) return 'conflict'
  const release = await lock(directory, {
    lockfilePath: join(directory, '.install-lock'),
    retries: { retries: 12, minTimeout: 200, maxTimeout: 1000 }
  })
  try {
    const manifestPath = join(directory, '.autumnmark-install.json')
    let manifest: Manifest | undefined
    let current: (string | undefined)[]
    try {
      manifest = parseManifest(await read(manifestPath))
      current = await Promise.all(files.map(name => read(join(directory, name))))
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === 'invalid-skill-file')) return 'conflict'
      throw error
    }
    const bundled = await Promise.all(bundledFiles.map(name => readFile(join(source, name), 'utf8')))
    const contents = [...bundled, runtime]
    const newer = (manifest?.revision ?? 0) > revision
    const previous: Hashes = {}
    const hashes: Hashes = {}
    for (const [index, name] of files.entries()) {
      const existing = current[index]
      const expected = hash(contents[index])
      hashes[name] = expected
      if (existing === undefined) {
        if (newer) return 'conflict'
        continue
      }
      const observed = hash(existing)
      const managed = manifest?.hashes[name] === observed || manifest?.previous?.[name] === observed
      if (!managed && (newer || (observed !== expected && observed !== legacy[name]))) return 'conflict'
      previous[name] = observed
    }
    if (newer) return 'ready'

    const changed = files.some(name => previous[name] !== hashes[name])
    if (changed) {
      // Record both sets of hashes before replacing files so a restart can finish a partial upgrade.
      await writeAtomic(manifestPath, JSON.stringify({ revision, hashes, previous }))
      for (const [index, name] of files.entries()) {
        if (previous[name] !== hashes[name]) await writeAtomic(join(directory, name), contents[index])
      }
    }
    if (changed || manifest?.revision !== revision || manifest?.previous) {
      await writeAtomic(manifestPath, JSON.stringify({ revision, hashes }))
    }
    return 'ready'
  } finally {
    await release()
  }
}
