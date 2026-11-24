import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchElectron, launchWithMarkdown, sendIpcToRenderer, waitForEditor, waitForMenuReady } from './helpers'

interface SkillResult {
  status: string
  error?: string
  target: string
  confirmed?: string
  revision: string
  markdown: string
  css: string
  directory: string
  scope: 'active' | 'draft'
  theme: { target: string; scope: 'active' | 'draft' }
  themes: { target: string; scope: 'active' | 'draft' }[]
  documents: { target: string; path: string }[]
  matches: number
  value: string | null
  visible: boolean
}

async function invoke(
  home: string, action: string,
  { target, input, inputPath, probe }: { target?: string; input?: object; inputPath?: string; probe?: string[] } = {}
): Promise<SkillResult> {
  const directory = join(home, '.agents', 'skills', 'autumnmark')
  const runtime = await readFile(join(directory, 'runtime.txt'), 'utf8')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^path$/i.test(name)))
  const args = inputPath ? ['--input-file', inputPath] : probe ?? (target ? [target] : [])
  const child = spawn(runtime, [join(directory, 'bridge.cjs'), action, ...args], {
    env: { ...env, Path: '', MARKTEXT_TEST_SKILL_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true
  })
  const closed = once(child, 'close')
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.stdin.end(input ? JSON.stringify(input) : '')
  await closed
  if (!stdout) throw new Error(stderr || 'The Skill helper returned no result')
  return JSON.parse(stdout)
}

test('explicit editor edits take priority over the open theme example', async() => {
  const { app, page } = await launchWithMarkdown('# Main document\n', {
    preferences: { language: 'en', autoSave: false, theme: 'light', followSystemTheme: false }
  })
  try {
    const home = await app.evaluate(() => process.env.MARKTEXT_TEST_SKILL_HOME ?? '')
    await expect(page.evaluate(() => window.electron.ipcRenderer.invoke('mt::autumnmark-skill::status'))).resolves.toBe('ready')
    const original = await invoke(home, 'read-document')
    expect(original).toMatchObject({ status: 'ok', markdown: '# Main document\n' })
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '# Current main tab\n')
    const mainHeading = page.locator('.mu-container h1')
    await expect(mainHeading).toContainText('Current main tab')

    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    await expect(studio.getByRole('button', { name: 'External collaboration', exact: true })).toBeVisible()
    const sample = await invoke(home, 'read-document')
    expect(sample).toMatchObject({ status: 'theme-sample-open', theme: { scope: 'draft' } })
    expect(await invoke(home, 'edit-document', { input: { ...original, markdown: '# Wrong destination\n' } }))
      .toMatchObject({ error: 'document-target-changed' })

    const workspace = await invoke(home, 'theme-workspace', { target: sample.theme.target })
    expect(workspace).toMatchObject({ status: 'ok', target: sample.theme.target })
    await writeFile(join(workspace.directory, 'sample.md'), '# Edited theme example\n')
    const heading = studio.frameLocator('iframe').locator('.mu-container h1')
    await expect(heading).toContainText('Edited theme example')
    await expect(mainHeading).toContainText('Current main tab')

    const main = await invoke(home, 'read-document', { target: '--editor' })
    expect(main).toMatchObject({ status: 'ok', confirmed: main.target, markdown: '# Current main tab\n' })
    expect(main.target).not.toBe(original.target)
    expect(await invoke(home, 'edit-document', { input: { ...main, markdown: '# Explicit main edit\n' } }))
      .toMatchObject({ status: 'ok' })
    await expect(mainHeading).toContainText('Explicit main edit')
    await expect(heading).toContainText('Edited theme example')
    expect(await invoke(home, 'read-document', { target: original.target })).toMatchObject({ markdown: '# Main document\n' })

    const active = await invoke(home, 'read-theme', { target: '--editor' })
    expect(active).toMatchObject({ status: 'ok', scope: 'active', confirmed: active.target })
    const draft = await invoke(home, 'read-theme', { target: '--draft' })
    expect(draft).toMatchObject({ status: 'ok', scope: 'draft', target: sample.theme.target, confirmed: sample.theme.target })
    const { themes } = await invoke(home, 'targets')
    expect(themes.map(theme => theme.target)).toEqual(expect.arrayContaining([active.target, draft.target]))
    const color = 'rgb(19, 148, 88)'
    const edited = await invoke(home, 'edit-theme', {
      input: { ...active, css: `:root .mu-container h1 { color: ${color}; }` }
    })
    expect(edited).toMatchObject({ status: 'ok', scope: 'active' })
    expect(edited.target).not.toBe(active.target)
    await expect(mainHeading).toHaveCSS('color', color)
    await expect(heading).not.toHaveCSS('color', color)
    expect(await invoke(home, 'measure-theme', { probe: ['--target', edited.target, '.mu-container h1', 'color'] }))
      .toMatchObject({ status: 'ok', scope: 'active', target: edited.target, value: color })
    expect(await invoke(home, 'read-theme')).toMatchObject({ scope: 'draft', target: draft.target, css: draft.css })

    await (await app.browserWindow(studio)).evaluate(win => win.close())
    await expect.poll(async() => (await invoke(home, 'read-document')).status).toBe('confirmation-required')
    expect(await invoke(home, 'theme-workspace', { target: sample.theme.target }))
      .toMatchObject({ error: 'theme-target-changed' })
  } finally {
    await app.close()
  }
})

test('the AutumnMark Skill confirms across instances and only edits the active theme destination', async() => {
  const preferences = { language: 'en', autoSave: false, theme: 'light', followSystemTheme: false }
  const primary = await launchWithMarkdown('# Main document\n', { preferences })
  let secondary: Awaited<ReturnType<typeof launchWithMarkdown>> | undefined
  try {
    const home = await primary.app.evaluate(() => process.env.MARKTEXT_TEST_SKILL_HOME ?? '')
    await expect(primary.page.evaluate(() => window.electron.ipcRenderer.invoke('mt::autumnmark-skill::status'))).resolves.toBe('ready')

    const first = await invoke(home, 'read-document')
    expect(first).toMatchObject({ status: 'ok', markdown: '# Main document\n' })
    const edit = {
      target: first.target,
      revision: first.revision,
      markdown: '# 已修改当前文档\n\n## ATX heading\n\nSetext heading\n--------------\n'
    }
    const requestFile = join(home, 'request.json')
    await writeFile(requestFile, '\uFEFF' + JSON.stringify(edit))
    expect(await invoke(home, 'edit-document', { inputPath: requestFile })).toMatchObject({ status: 'ok' })
    await expect(primary.page.locator('.mu-container h1')).toContainText('已修改当前文档')
    expect(await readFile(primary.filePath, 'utf8')).toContain('Main document')
    expect(await invoke(home, 'edit-document', { input: edit })).toMatchObject({ error: 'document-changed' })

    const active = await invoke(home, 'read-theme')
    expect(active).toMatchObject({ status: 'ok', scope: 'active' })
    const headingColor = { probe: ['.mu-container h2', 'color'] }
    expect(await invoke(home, 'measure-theme', headingColor)).toMatchObject({
      status: 'ok', scope: 'active', matches: 2, value: 'rgb(255, 255, 255)', visible: true
    })
    const tied = '.mu-container .mu-atx-heading:where(h2) { color: #123456; }'
    expect(await invoke(home, 'edit-theme', { input: { ...active, css: tied } })).toMatchObject({ status: 'ok' })
    expect(await invoke(home, 'measure-theme', headingColor)).toMatchObject({ value: 'rgb(255, 255, 255)' })
    const tiedTheme = await invoke(home, 'read-theme')
    const higher = '.mu-container h2:is(.mu-atx-heading, .mu-setext-heading) { color: #123456; }'
    const css = ':root { --editorColor: #712345; }\n' + higher
    expect(await invoke(home, 'edit-theme', { input: { ...tiedTheme, css } }))
      .toMatchObject({ status: 'ok' })
    expect(await invoke(home, 'measure-theme', headingColor)).toMatchObject({ value: 'rgb(18, 52, 86)' })
    expect(await invoke(home, 'measure-theme', { probe: ['.mu-container h2', 'color', '2'] }))
      .toMatchObject({ value: 'rgb(18, 52, 86)' })
    expect(await invoke(home, 'measure-theme', { probe: ['.mu-container h6', 'color'] }))
      .toMatchObject({ status: 'ok', matches: 0, value: null, visible: false })
    const applied = () => primary.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editorColor').trim())
    await expect.poll(applied).toBe('#712345')
    const activeRevision = await invoke(home, 'read-theme')

    secondary = await launchWithMarkdown('# Other document\n', { preferences, env: { MARKTEXT_TEST_SKILL_HOME: home } })
    await expect.poll(async() => (await invoke(home, 'read-document')).status).toBe('confirmation-required')
    const choices = await invoke(home, 'read-document')
    expect(choices.documents.map(document => document.path)).toEqual(expect.arrayContaining([primary.filePath, secondary.filePath]))
    expect(choices).not.toHaveProperty('markdown')
    const target = choices.documents.find(document => document.path === secondary?.filePath)?.target
    expect(target).toBeTruthy()
    const selected = await invoke(home, 'read-document', { target })
    expect(selected).toMatchObject({ target, confirmed: target, markdown: '# Other document\n' })
    const change = { target: selected.target, revision: selected.revision, markdown: '# Chosen document\n' }
    expect(await invoke(home, 'edit-document', { input: change })).toMatchObject({ status: 'confirmation-required' })
    expect(await invoke(home, 'edit-document', { input: { ...change, confirmed: selected.confirmed } })).toMatchObject({ status: 'ok' })
    await expect(secondary.page.locator('.mu-container h1')).toContainText('Chosen document')
    await expect(primary.page.locator('.mu-container h1')).toContainText('已修改当前文档')

    const opened = primary.app.waitForEvent('window')
    await clickMenuById(primary.app, 'createThemeFromCurrent')
    const studio = await opened
    await expect(studio.getByRole('button', { name: 'External collaboration', exact: true })).toBeVisible()
    const draft = await invoke(home, 'read-theme')
    expect(draft).toMatchObject({ status: 'ok', scope: 'draft' })
    expect(await invoke(home, 'read-theme', { target: activeRevision.target }))
      .toMatchObject({ status: 'ok', scope: 'active', target: activeRevision.target, confirmed: activeRevision.target })
    expect(await invoke(home, 'edit-theme', { input: { ...activeRevision, css: ':root { --editorColor: #654321; }' } }))
      .toMatchObject({ error: 'theme-target-changed' })
    expect(await invoke(home, 'edit-theme', {
      input: { ...draft, css: ':root .mu-container h1 { color: rgb(100, 50, 120); }' }
    })).toMatchObject({ status: 'ok', scope: 'draft' })
    await expect(studio.frameLocator('iframe').locator('h1').first()).toHaveCSS('color', 'rgb(100, 50, 120)')
    expect(await invoke(home, 'measure-theme', { probe: ['.mu-container h1', 'color'] }))
      .toMatchObject({ status: 'ok', scope: 'draft', value: 'rgb(100, 50, 120)', visible: true })
    expect(await applied()).toBe('#712345')
    const workspace = await invoke(home, 'theme-workspace')
    expect(workspace).toMatchObject({ status: 'ok', scope: 'draft' })
    expect(await readFile(join(workspace.directory, 'theme.css'), 'utf8')).toContain('rgb(100, 50, 120)')
  } finally {
    await secondary?.app.close()
    await primary.app.close()
  }
})

test('external edits to the applied theme persist and can be restored without a model', async() => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'autumnmark-applied-theme-history-'))
  let running: Awaited<ReturnType<typeof launchElectron>> | undefined
  try {
    const started = await launchWithMarkdown('## Heading\n', {
      userDataDir, preferences: { language: 'en', theme: 'light', followSystemTheme: false }
    })
    running = started
    await clickMenuById(started.app, 'openActiveThemeHistory')
    const empty = started.page.getByRole('dialog', { name: 'Version history' })
    await expect(empty).toContainText('There are no changes in this history yet.')
    await empty.getByRole('button', { name: 'Close', exact: true }).click()

    const home = await started.app.evaluate(() => process.env.MARKTEXT_TEST_SKILL_HOME ?? '')
    await expect(started.page.evaluate(() => window.electron.ipcRenderer.invoke('mt::autumnmark-skill::status'))).resolves.toBe('ready')
    const original = await invoke(home, 'read-theme')
    const rule = (color: string) => `.mu-container h2:is(.mu-atx-heading, .mu-setext-heading) { color: ${color}; }`
    expect(await invoke(home, 'edit-theme', { input: { ...original, css: rule('#123456') } })).toMatchObject({ status: 'ok' })
    const first = await invoke(home, 'read-theme')
    expect(await invoke(home, 'edit-theme', { input: { ...first, css: rule('#654321') } })).toMatchObject({ status: 'ok' })
    await expect(started.page.locator('.mu-container h2')).toHaveCSS('color', 'rgb(101, 67, 33)')
    await started.app.close()
    running = undefined

    running = await launchElectron([started.filePath], { userDataDir })
    const { app, page } = running
    await waitForEditor(page)
    await waitForMenuReady(app)
    await clickMenuById(app, 'openActiveThemeHistory')
    const history = page.getByRole('dialog', { name: 'Version history' })
    const versions = history.getByRole('navigation')
    const edits = versions.getByRole('button', { name: /Collaboration edit/ })
    await expect(edits).toHaveCount(2)
    await expect(versions.getByText('Currently applied', { exact: true })).toBeVisible()
    await edits.last().click()
    await history.getByRole('button', { name: 'Restore and apply' }).click()
    await history.getByRole('button', { name: 'Confirm restore' }).click()
    await expect(page.locator('.mu-container h2')).toHaveCSS('color', 'rgb(18, 52, 86)')
    await expect(versions.getByRole('button', { name: /Restore/ })).toHaveCount(1)
    await expect(edits).toHaveCount(2)

    await versions.getByRole('button', { name: /Initial version/ }).click()
    await history.getByRole('button', { name: 'Restore and apply' }).click()
    await history.getByRole('button', { name: 'Confirm restore' }).click()
    await expect(page.locator('.mu-container h2')).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(versions.getByRole('button')).toHaveCount(5)
  } finally {
    await running?.app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
