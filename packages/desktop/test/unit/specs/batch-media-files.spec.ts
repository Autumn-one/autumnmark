import { link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { listMediaDocuments } from 'main_renderer/filesystem/mediaDocuments'
import { writePreservingHardlinks } from 'main_renderer/filesystem/hardlinkWrite'

let directory: string
beforeEach(async() => { directory = await realpath(await mkdtemp(join(tmpdir(), 'autumnmark-media-'))) })
afterEach(async() => { await rm(directory, { recursive: true, force: true }) })

it('terminates through ancestor junctions, groups hard links and stays inside the selected folder', async() => {
  const root = join(directory, 'project')
  const child = join(root, 'child')
  const elsewhere = join(directory, 'elsewhere')
  await mkdir(child, { recursive: true })
  await mkdir(elsewhere)
  const file = join(root, 'first.md')
  const alias = join(child, 'alias.md')
  await writeFile(file, 'original')
  await link(file, alias)
  await writeFile(join(elsewhere, 'outside.md'), 'outside')
  await symlink(root, join(child, 'cycle'), 'junction')
  await symlink(child, join(root, 'alias'), 'junction')
  const sibling = join(root, 'sibling')
  await mkdir(sibling)
  await symlink(sibling, join(child, 'to-sibling'), 'junction')
  await symlink(child, join(sibling, 'to-child'), 'junction')
  await symlink(elsewhere, join(root, 'external'), 'junction')
  const result = await listMediaDocuments(root, true, [])
  expect(result.issues).toEqual([])
  expect(result.files).toHaveLength(1)
  expect(new Set(result.files[0])).toEqual(new Set([file, alias]))
  await expect(writePreservingHardlinks(alias, async target => {
    await writeFile(target, 'partial')
    throw new Error('incomplete')
  })).rejects.toThrow('incomplete')
  expect(await readFile(file, 'utf8')).toBe('original')
  await writePreservingHardlinks(alias, target => writeFile(target, 'done'))
  expect(await readFile(file, 'utf8')).toBe('done')
  expect((await stat(file, { bigint: true })).ino).toBe((await stat(alias, { bigint: true })).ino)
  expect((await stat(alias)).nlink).toBe(2)
})
