import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('one theme studio switches independent drafts and applies a theme without closing', async() => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    const content = [
      { sampleMarkdown: '# Cedar example\n\n## Details' },
      { message: 'Updated the cedar example.' }
    ].map(value => JSON.stringify(value)).join('\n')
    response.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const nightId = 'local:nord:ad36974a-7253-4c54-8550-d22af67de076'
  const profile = { id: 'text', model: 'test', encryptedKey: '', requestType: 'chat-completions',
    baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, inputTypes: [], reasoningEffort: '', contextSize: null, outputSize: null }
  const { app } = await launchWithMarkdown('Document', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false,
      localThemes: [{ version: 1, id: nightId, name: 'Night notes', base: 'nord', values: {}, css: '' }] },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) }
  })
  try {
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = async() => {}
    })
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const preview = studio.frameLocator('iframe')
    const name = studio.locator('.studio-toolbar').getByLabel('Theme name')
    const log = studio.getByRole('log')
    const library = studio.getByRole('dialog', { name: 'Theme library', exact: true })
    const openLibrary = () => studio.getByRole('button', { name: 'Theme library', exact: true }).click()
    const external = studio.getByRole('button', { name: 'External collaboration', exact: true })
    const collaboration = studio.getByRole('dialog', { name: 'External collaboration', exact: true })
    const draft = (title: string) => library.getByRole('region', { name: 'Drafts', exact: true }).getByRole('button', { name: new RegExp('^' + title) })
    const saved = (title: string) => library.getByRole('region', { name: 'My themes', exact: true }).getByRole('button', { name: new RegExp('^' + title) })
    const startCollaboration = async() => {
      await external.click()
      await collaboration.getByRole('button', { name: 'Copy folder path' }).click()
      await expect(collaboration.getByRole('status')).toHaveText('Folder path copied.')
      const path = await collaboration.locator('code').innerText()
      await external.click()
      return path
    }
    const create = async(title: string, base: string) => {
      await openLibrary()
      await library.getByRole('button', { name: 'New theme', exact: true }).click()
      await library.getByLabel('Theme name').fill(title)
      await library.getByLabel('Base theme').selectOption(base)
      await library.getByRole('button', { name: 'Create draft' }).click()
      await expect(name).toHaveValue(title)
    }

    await name.fill('Cedar draft')
    await studio.getByLabel('Message the theme assistant').fill('Write a cedar example')
    await studio.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(log).toContainText('Updated the cedar example.')
    const cedarPath = await startCollaboration()
    await studio.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('autumnmark.theme-chats')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction('chats', 'readwrite')
        const chats = transaction.objectStore('chats')
        const read = chats.getAll()
        read.onsuccess = () => {
          const chat = read.result.find(item => item.title === 'Write a cedar example')
          if (!chat) { transaction.abort(); return }
          delete chat.draftUuid
          chats.put(chat)
        }
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Missing cedar chat')) }
      }
    }))
    await create('Mint draft', 'light')
    await expect(log.locator('article')).toHaveCount(0)
    await expect(preview.locator('h1')).toContainText('Ridge notes')
    const mintPath = await startCollaboration()
    expect(mintPath).not.toBe(cedarPath)
    await writeFile(join(mintPath, 'sample.md'), '# Mint example')
    await expect(preview.locator('h1')).toContainText('Mint example')

    await openLibrary()
    await draft('Cedar draft').click()
    await expect(name).toHaveValue('Cedar draft')
    await expect(preview.locator('h1')).toContainText('Cedar example')
    await expect(log).toContainText('Write a cedar example')
    const reopenedCedarPath = await startCollaboration()
    expect(dirname(reopenedCedarPath)).toBe(dirname(cedarPath))
    expect(await readFile(join(reopenedCedarPath, 'sample.md'), 'utf8')).toContain('# Cedar example')

    const save = studio.getByRole('button', { name: 'Save theme only', exact: true })
    await save.click()
    await expect(save).toBeEnabled()
    await openLibrary()
    await expect(saved('Cedar draft')).toBeVisible()
    await expect(saved('Cedar draft')).not.toContainText('Currently applied')
    await openLibrary()
    const options = studio.getByRole('button', { name: 'Save options', exact: true })
    await options.click()
    await studio.getByRole('button', { name: 'Save and apply', exact: true }).click()
    await expect(options).toBeEnabled()
    expect(studio.isClosed()).toBe(false)
    await openLibrary()
    await expect(saved('Cedar draft')).toContainText('Currently applied')
    await saved('Night notes').click()
    await expect(name).toHaveValue('Night notes')
    await expect(studio.locator('.base-control select')).toBeDisabled()
    await expect(log.locator('article')).toHaveCount(0)
    expect(app.windows().filter(window => window.url().includes('theme-studio.html'))).toHaveLength(1)
    await openLibrary()
    await draft('Mint draft').click()
    await expect(preview.locator('h1')).toContainText('Mint example')
    await create('Mint copy', 'current')
    await expect(preview.locator('h1')).toContainText('Mint example')
    await expect(log.locator('article')).toHaveCount(0)
    await studio.reload()
    await expect(name).toHaveValue('Mint copy')
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('the theme library deletes drafts and applied themes across a reload', async() => {
  const id = 'local:light:ad36974a-7253-4c54-8550-d22af67de076'
  const { app, page } = await launchWithMarkdown('Document', {
    preferences: {
      language: 'en', theme: id, followSystemTheme: false, lightModeTheme: id,
      localThemes: [{ version: 1, id, name: 'Saved theme', base: 'light', values: {}, css: '' }]
    }
  })
  try {
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const name = studio.locator('.studio-toolbar').getByLabel('Theme name')
    const library = studio.getByRole('dialog', { name: 'Theme library', exact: true })
    const openLibrary = () => studio.getByRole('button', { name: 'Theme library', exact: true }).click()
    const deleteDraft = library.getByRole('button', { name: 'Delete draft · Disposable draft', exact: true })

    await name.fill('Disposable draft')
    await studio.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(studio.getByRole('button', { name: 'Conversation', exact: true })).toBeEnabled()
    const { draftKey, chatId } = await studio.evaluate(() => {
      const draftKey = sessionStorage.getItem('autumnmark.theme-studio.active-draft') ?? ''
      return { draftKey, chatId: localStorage.getItem(draftKey + '.chat') ?? '' }
    })
    expect(chatId).not.toBe('')
    await openLibrary()
    await library.getByRole('button', { name: /^Saved theme/ }).click()
    await expect(name).toHaveValue('Saved theme')

    await openLibrary()
    await deleteDraft.click()
    const cancel = library.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancel).toBeFocused()
    await cancel.click()
    await expect(deleteDraft).toBeFocused()
    await deleteDraft.click()
    await library.getByRole('button', { name: 'Delete draft', exact: true }).click()
    await expect(name).toHaveValue('Saved theme')

    await openLibrary()
    await expect(deleteDraft).toHaveCount(0)
    expect(await studio.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull()
    const deletedChat = await studio.evaluate(id => new Promise((resolve, reject) => {
      const opening = indexedDB.open('autumnmark.theme-chats')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const read = db.transaction('chats').objectStore('chats').get(id)
        read.onsuccess = () => { db.close(); resolve(read.result) }
        read.onerror = () => { db.close(); reject(read.error) }
      }
    }), chatId)
    expect(deletedChat).toBeUndefined()
    await library.getByRole('button', { name: 'Delete theme · Saved theme', exact: true }).click()
    await expect(library.getByText(/switch to this theme’s built-in base theme/)).toBeVisible()
    await library.getByRole('button', { name: 'Delete theme', exact: true }).click()
    await expect(name).toHaveValue('My new theme')
    const prefs = await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(prefs).toMatchObject({ theme: 'light', lightModeTheme: 'light', localThemes: [] })

    await studio.reload()
    await openLibrary()
    await expect(library.getByText('No drafts or saved themes yet.')).toBeVisible()
  } finally {
    await app.close()
  }
})
