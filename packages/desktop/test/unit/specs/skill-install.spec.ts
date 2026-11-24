import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareAutumnMarkSkill } from 'main_renderer/ipc/skillInstall'

describe('AutumnMark Skill startup installation', () => {
  let root: string
  let source: string
  let installed: string
  const runtime = '/app/AutumnMark'
  const manifestName = '.autumnmark-install.json'

  beforeEach(async() => {
    root = await mkdtemp(join(tmpdir(), 'autumnmark-managed-skill-'))
    source = join(root, 'bundled')
    installed = join(root, '.agents', 'skills', 'autumnmark')
    await mkdir(source)
    await Promise.all([
      writeFile(join(source, 'SKILL.md'), 'AutumnMark instructions'),
      writeFile(join(source, 'bridge.cjs'), 'Bridge'),
      writeFile(join(source, 'theme-workspace.md'), 'Theme instructions')
    ])
  })

  afterEach(async() => {
    await rm(root, { recursive: true, force: true })
  })

  it('installs on startup and upgrades a managed old bundle across concurrent starts', async() => {
    await expect(prepareAutumnMarkSkill(root, source, runtime)).resolves.toBe('ready')
    expect(await readFile(join(installed, 'runtime.txt'), 'utf8')).toBe(runtime)
    const path = join(installed, manifestName)
    const previous = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...previous, revision: 1 }))
    await writeFile(join(source, 'SKILL.md'), 'Updated instructions')
    await expect(Promise.all([
      prepareAutumnMarkSkill(root, source, runtime),
      prepareAutumnMarkSkill(root, source, runtime)
    ])).resolves.toEqual(['ready', 'ready'])
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toBe('Updated instructions')
  })

  it('preserves a user-modified Skill and leaves a newer managed version in place', async() => {
    await prepareAutumnMarkSkill(root, source, runtime)
    const skill = join(installed, 'SKILL.md')
    await writeFile(skill, 'Custom instructions')
    await expect(prepareAutumnMarkSkill(root, source, runtime)).resolves.toBe('conflict')
    expect(await readFile(skill, 'utf8')).toBe('Custom instructions')
    await writeFile(skill, 'AutumnMark instructions')

    const path = join(installed, manifestName)
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...manifest, revision: 99 }))
    await writeFile(join(source, 'SKILL.md'), 'Old instructions')
    await expect(prepareAutumnMarkSkill(root, source, '/older/AutumnMark')).resolves.toBe('ready')
    expect(await readFile(skill, 'utf8')).toBe('AutumnMark instructions')
    expect(await readFile(join(installed, 'runtime.txt'), 'utf8')).toBe(runtime)
  })
})
