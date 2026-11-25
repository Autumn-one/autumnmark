import { ipcMain, shell, clipboard } from 'electron'
import log from 'electron-log'
import { fileURLToPath } from 'url'
import type { ClipboardImageWriteOptions } from '@shared/types/ipc'
import { mimeFromImagePath, videoMime } from '../../shared/embeddedImage'
import { writeClipboardImage } from './clipboardImage'

async function clipboardFilePath(items: Electron.ClipboardItem[]) {
  const files = items.find(item => item.types.includes('text/uri-list'))
  if (!files) return ''
  const uri = (await (await files.getType('text/uri-list')).text()).split(/\r?\n/).find(line => /^file:\/\//i.test(line))
  return uri ? fileURLToPath(uri) : ''
}

async function getClipboardImageInput(kind: 'image' | 'video' = 'image') {
  const items = await clipboard.read()
  const path = await clipboardFilePath(items)
  if (kind === 'video' ? videoMime(path) : mimeFromImagePath(path)) return path
  for (const item of items) {
    const mime = item.types.find(type => type.startsWith(kind + '/'))
    if (mime) return { item, mime }
  }
  const text = items.find(item => item.types.includes('text/plain'))
  if (!text) return null
  const value = (await (await text.getType('text/plain')).text()).trim()
  if (!value.slice(0, 11).toLowerCase().startsWith('data:' + kind + '/')) return null
  return value.slice(0, value.indexOf(',')).toLowerCase().endsWith(';base64') ? value : null
}

export const registerShellHandlers = (): void => {
  ipcMain.handle('mt::shell::open-external', async(_e, url: string) => {
    try {
      await shell.openExternal(url)
      return true
    } catch (err) {
      log.error('shell.openExternal failed:', err)
      return false
    }
  })
  ipcMain.on('mt::shell::open-external', (_e, url: string) => {
    shell.openExternal(url).catch((err) => log.error('shell.openExternal failed:', err))
  })
  ipcMain.on('mt::shell::show-item', (_e, fullPath: string) => {
    try {
      shell.showItemInFolder(fullPath)
    } catch (err) {
      log.error('shell.showItemInFolder failed:', err)
    }
  })
  ipcMain.handle('mt::shell::open-path', async(_e, fullPath: string) => {
    try {
      return await shell.openPath(fullPath)
    } catch (err) {
      log.error('shell.openPath failed:', err)
      return String(err instanceof Error ? err.message : err)
    }
  })

  ipcMain.handle('mt::clipboard::write-text', async(_e, text: string) => {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle(
    'mt::clipboard::write-image',
    async(event, bytes: Uint8Array, options?: ClipboardImageWriteOptions) => {
      try {
        return await writeClipboardImage(event.sender.id, bytes, options)
      } catch (err) {
        log.error('clipboard.write failed:', err)
        return false
      }
    }
  )

  ipcMain.handle('mt::clipboard::read-text', async() => {
    try {
      return await clipboard.readText()
    } catch {
      return ''
    }
  })

  ipcMain.handle('mt::clipboard::has-image', async(_event, kind?: 'video') => (await getClipboardImageInput(kind)) !== null)
  ipcMain.handle('mt::clipboard::image-input', async(_event, kind?: 'video') => {
    const input = await getClipboardImageInput(kind)
    if (typeof input === 'string' || !input) return input
    const blob = await input.item.getType(input.mime)
    if (!(blob instanceof Blob)) return null
    return { mime: input.mime, data: new Uint8Array(await blob.arrayBuffer()) }
  })
  ipcMain.handle('mt::clipboard::guess-file-path', async() => {
    try {
      // Electron maps native file references to this MIME type on all platforms.
      return await clipboardFilePath(await clipboard.read())
    } catch (err) {
      log.error('clipboard.guess-file-path failed:', err)
      return ''
    }
  })
}
