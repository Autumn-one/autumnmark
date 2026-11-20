import { expect, test } from '@playwright/test'
import { copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { enterSourceMode, getMarkdownContent, launchElectron, waitForEditor, expectNoRendererErrors, setSourceMarkdown } from './helpers'

test('scans the selected folder, converts only checked media, and reopens on a single file', async() => {
  test.setTimeout(60000)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'autumnmark-embed-')))
  const nested = join(root, 'nested')
  await mkdir(nested)
  const first = join(root, 'first.md')
  const second = join(nested, 'second.md')
  const alias = join(nested, 'copy.md')
  await copyFile(resolve('static/logo-96px.png'), join(root, 'picture.png'))
  await copyFile(resolve('test/e2e/data/portrait.mp4'), join(root, 'clip.mp4'))
  await writeFile(first, '![picture](picture.png)\n\n<video src="clip.mp4"></video>\n')
  const contents = '\uFEFF![leaf](../picture.png)\r\n\r\n<video controls src="../clip.mp4"></video>\n'
  await writeFile(second, contents)
  await link(second, alias)
  await symlink(root, join(nested, 'cycle'), 'junction')
  const { app, page } = await launchElectron([first], {
    windowLayout: { showSideBar: true, showTabBar: true },
    preferences: { language: 'en', autoSave: false },
    suppressErrorDialog: true
  })
  try {
    await waitForEditor(page)
    await app.evaluate(({ ipcMain, BrowserWindow }, pathname) => {
      ipcMain.removeAllListeners('mt::menu::popup')
      ipcMain.on('mt::menu::popup', (event, template: Array<{ id?: string }>) => {
        const action = template.find(item => item.id?.startsWith('embedBatchMedia-'))
        if (action) event.sender.send('mt::menu::click', { id: action.id })
      })
      ipcMain.emit('app-add-directory-by-id', BrowserWindow.getAllWindows()[0].id, pathname)
    }, root)
    const folder = page.locator('.project-root')
    const dialog = page.getByRole('dialog', { name: 'Batch embed images and videos' })
    await expect(folder).toBeVisible()
    await expect(page.locator('.root-status')).toHaveCount(0)
    await folder.click({ button: 'right' })
    const images = dialog.getByRole('checkbox', { name: 'Images (2)' })
    const videos = dialog.getByRole('checkbox', { name: 'Videos (2)' })
    await expect(images).toBeChecked()
    await expect(videos).toBeChecked()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await readFile(second, 'utf8')).toBe(contents)
    await folder.click({ button: 'right' })
    await dialog.getByText('Images (2)', { exact: true }).click()
    await dialog.getByText('Videos (2)', { exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Embed selected (0)' })).toBeDisabled()
    await dialog.getByText('Videos (2)', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Embed selected (2)' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Media references embedded: 2')
    const data = 'data:video/mp4;base64,' + (await readFile(join(root, 'clip.mp4'))).toString('base64')
    expect(await readFile(second, 'utf8') === contents.replace('../clip.mp4', data)).toBe(true)
    expect((await stat(alias, { bigint: true })).ino).toBe((await stat(second, { bigint: true })).ino)
    expect((await readFile(first, 'utf8')).includes(data)).toBe(true)
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    await page.locator('.tabs-container > li.active').click({ button: 'right' })
    await expect(dialog.getByRole('checkbox', { name: 'Videos (0)' })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Images (1)' })).toBeChecked()
    await dialog.getByRole('button', { name: 'Embed selected (1)' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Media references embedded: 1')
    expect(await readFile(first, 'utf8')).toContain('data:image/png;base64,')
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()

    const saved = await readFile(first, 'utf8')
    await setSourceMarkdown(page, app, 'Unsaved note\n\n![new](picture.png)\n')
    await enterSourceMode(page, app)
    const row = page.locator('.side-bar-file').filter({ hasText: 'first.md' })
    if (!await row.isVisible()) await folder.click()
    await row.click({ button: 'right' })
    await dialog.getByRole('button', { name: 'Embed selected (1)' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Media references embedded: 1')
    expect((await readFile(first, 'utf8')) === saved).toBe(true)
    const draft = await getMarkdownContent(page, app)
    expect(draft).toContain('Unsaved note')
    expect(draft).toContain('data:image/png;base64,')
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()

    await folder.click({ button: 'right' })
    await expect(dialog.getByRole('checkbox', { name: 'Images (1)' })).toBeChecked()
    await writeFile(second, 'Externally edited')
    await dialog.getByRole('button', { name: 'Embed selected (1)' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Media references embedded: 0')
    await expect(dialog.getByText('Issues (1)')).toBeVisible()
    expect(await readFile(alias, 'utf8')).toBe('Externally edited')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
