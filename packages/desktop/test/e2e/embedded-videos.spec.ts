import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator } from 'playwright'
import { copyFileSync, readFileSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { join, dirname } from 'node:path'
import type { MenuTemplate } from '../../src/shared/types/menu'
import {
  clickMenuById,
  enterSourceMode,
  exitSourceMode,
  getMarkdownContent,
  launchElectron,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Three VP8 frames with a real seekable WebM container.
const bytes = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHzEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggETTbuMU6uEHFO7a1OsggHd7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiECCwAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBILqBGJqBAlWwhFW5gQESVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC42MDAwMDAwMDAAH0O2dfDngQCjvYEAAIAQAwCdASogABgAAEcIhYWIhYSIAgICdaoD+AP6AghZDL0A/v1u8//itYdZxf+K3//TZPFXjP/piwCjlYEAyACxAQABEBAAGAAYWC/0AAhwAKOVgQGQALEBAAEQEAAYABhYL/QACHAAHFO7a5G7j7OBALeK94EB8YIBaPCBAw==',
  'base64'
)
const source = 'data:video/webm;base64,' + bytes.toString('base64')
const title = 'sample & clip.webm'
const markup =
  '<video controls preload="metadata" title="sample &amp; clip.webm" src="' + source + '"></video>'

test('large embedded video stays compact through typing, source copy, undo and a disk round trip', async() => {
  const payload = Buffer.concat([bytes, Buffer.alloc(10 * 1024 * 1024)]).toString('base64')
  const video = markup.replace(source, 'data:video/webm;base64,' + payload)
  const { app, page, filePath } = await launchWithMarkdown(video + '\n\nAfter', {
    preferences: { language: 'en' }
  })
  try {
    const player = page.locator('.mu-embedded-video video').first()
    await expect(player).toHaveAttribute('src', /^blob:/)
    await expect(player).toHaveJSProperty('videoWidth', 32)
    await page.getByText('After', { exact: true }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' typing')
    await enterSourceMode(page, app)
    const cm = page.locator('.source-code .CodeMirror')
    const workingText = () => cm.evaluate(el =>
      (el as HTMLElement & { CodeMirror?: { getValue(): string } }).CodeMirror?.getValue() ?? '')
    expect((await workingText()).length).toBeLessThan(500)
    await cm.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText(' more')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async() => (await workingText()).trimEnd().endsWith('After typing')).toBe(true)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+c')
    const expected = video + '\n\nAfter typing'
    await expect.poll(() => app.evaluate(async({ clipboard }) => {
      const copied = (await clipboard.readText()).replaceAll('\r\n', '\n').trimEnd()
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(copied))
      return Buffer.from(digest).toString('hex')
    })).toBe(createHash('sha256').update(expected).digest('hex'))
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n').trimEnd() === expected).toBe(true)
  } finally {
    await app.close()
  }
  const reopened = await launchElectron([filePath], { preferences: { language: 'en' } })
  try {
    await expect(reopened.page.locator('.mu-embedded-video video').first()).toHaveJSProperty('videoWidth', 32)
    await expect(reopened.page.getByText('After typing', { exact: true }).first()).toBeVisible()
  } finally {
    await reopened.app.close()
  }
})

test('compact videos scale and play inline while images and code retain their toggles', async() => {
  const paragraphs = Array.from({ length: 40 }, (_, i) => 'Paragraph ' + i).join('\n\n')
  const portrait = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="1800"></svg>'
  const image = `![Portrait](data:image/svg+xml;base64,${Buffer.from(portrait).toString('base64')})`
  const code = ['```', ...Array.from({ length: 100 }, (_, i) => 'line ' + i), '```'].join('\n')
  const video = markup.replace('<video ', '<video width="180" height="1800" ')
  const videoBlock = `<video controls width="180" height="1800">\n<source src="${source}">\n</video>`
  const { app, page } = await launchWithMarkdown([paragraphs, image, code, video, videoBlock, paragraphs].join('\n\n'), {
    preferences: { language: 'en', compactMode: true, compactImageMaxHeight: 320, compactVideoMaxHeight: 180 }
  })
  try {
    const toggles = page.locator('.editor-component .mu-compact-toggle')
    await expect(toggles).toHaveCount(2)
    for (const toggle of await toggles.all()) {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const before = await toggle.evaluate(el => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        return el.getBoundingClientRect().top
      })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect.poll(() => toggle.evaluate((el, top) => Math.abs(el.getBoundingClientRect().top - top), before)).toBeLessThan(2)
    }
    const players = page.locator('.mu-embedded-video video:visible')
    await expect(players).toHaveCount(2)
    for (const player of await players.all()) {
      await expect(player).toHaveJSProperty('videoWidth', 32)
      await expect(player).toHaveJSProperty('controls', true)
      await expect.poll(() => player.evaluate(el => [el.clientWidth, el.clientHeight])).toEqual([240, 180])
      expect(await player.evaluate(el => {
        const block = el.closest('.mu-paragraph-content, .mu-html-preview')
        return block && block.scrollHeight <= block.clientHeight
      })).toBe(true)
      await player.evaluate(el => { (el as HTMLVideoElement).loop = true })
      await player.hover()
      await player.click({ position: { x: 26, y: 133 } })
      await expect(player).toHaveJSProperty('paused', false)
      await player.click({ position: { x: 26, y: 133 } })
      await expect(player).toHaveJSProperty('paused', true)
      await player.click({ position: { x: 170, y: 158 } })
      await expect.poll(() => player.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0.2)
      await expect(page.locator('.embedded-video-player')).toHaveCount(0)
    }
    await page.locator('.mu-html-preview .mu-embedded-video video').click({ position: { x: 110, y: 12 } })
    await expect(page.locator('.embedded-video-player')).toHaveJSProperty('videoWidth', 32)
  } finally {
    await app.close()
  }
})

async function chooseAction(app: ElectronApplication, target: Locator, label: string) {
  await app.evaluate(({ ipcMain }, label) => {
    ipcMain.removeAllListeners('mt::menu::popup')
    ipcMain.on('mt::menu::popup', (event, items: MenuTemplate) => {
      const item = items
        .flatMap((item) => [item, ...(item.submenu ?? [])])
        .find((item) => item.enabled && item.label === label)
      if (item) event.sender.send('mt::menu::click', { id: item.id })
      event.sender.send('mt::menu::closed', {})
    })
  }, label)
  await target.click({ button: 'right' })
}

test('a converted MP4 survives draft recovery, moving the Markdown alone and seeking in the focused paragraph', async() => {
  const input = test.info().outputPath(' 中文示例！ .mp4')
  copyFileSync(join(__dirname, 'data', 'portrait.mp4'), input)
  truncateSync(input, 32 * 1024 * 1024 + 1)
  const size = statSync(input).size
  const digest = createHash('sha256').update(readFileSync(input)).digest('hex')
  const markup = `<video controls title=" 中文示例！ .mp4" src="${pathToFileURL(input).href}"></video>`
  const { app, page, filePath } = await launchWithMarkdown(markup, { preferences: { language: 'en' } })
  const moved = test.info().outputPath('moved.md')
  const profile = await app.evaluate(({ app }) => app.getPath('userData'))
  try {
    const player = page.locator('.mu-embedded-video video').first()
    await expect(player).toHaveJSProperty('videoHeight', 360)
    await chooseAction(app, player, 'Embed video in Markdown')
    await expect(player).toHaveAttribute('src', /video-attachments/)
    await expect.poll(() => readFileSync(join(profile, 'state', 'application-state.json'), 'utf8')).toContain('"recovery"')
  } finally {
    await app.close()
  }
  unlinkSync(input)
  const recovered = await launchElectron([], { userDataDir: profile })
  try {
    await expect(recovered.page.locator('.mu-embedded-video video').first()).toHaveJSProperty('videoHeight', 360)
    await clickMenuById(recovered.app, 'fileSaveMenuItem')
    await expect.poll(() => statSync(filePath).size).toBeGreaterThan(size)
    copyFileSync(filePath, moved)
  } finally {
    await recovered.app.close()
  }
  const reopened = await launchElectron([moved])
  try {
    const player = reopened.page.locator('.mu-embedded-video video').first()
    await expect(player).toHaveJSProperty('videoHeight', 360)
    const restored = fileURLToPath(await player.evaluate(el => (el as HTMLVideoElement).currentSrc))
    expect(createHash('sha256').update(readFileSync(restored)).digest('hex')).toBe(digest)
    await player.hover()
    const box = await player.boundingBox()
    if (!box) throw new Error('Missing inline player')
    const seek = (fraction: number) => player.click({ position: { x: box.width * fraction, y: box.height - 22 } })
    const time = () => player.evaluate(el => (el as HTMLVideoElement).currentTime)
    await seek(0.75)
    await expect.poll(time).toBeGreaterThan(1)
    await seek(0.25)
    await expect.poll(time).toBeLessThan(0.8)
    await expect(reopened.page.locator('.embedded-video-player')).toHaveCount(0)
  } finally {
    await reopened.app.close()
  }
})

test('a saved remote video reopens offline with embedding switched off', async() => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/webm' })
    res.end(bytes)
  })
  const { app, page, filePath } = await launchWithMarkdown('Start', { preferences: { language: 'en', embedVideos: true } })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await paragraph.evaluate((node, url) => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', url)
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/offline.webm')
    await expect(page.locator('.mu-embedded-video')).toBeVisible()
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(source)
  } finally {
    server.close()
    await app.close()
  }
  const reopened = await launchElectron([filePath], { preferences: { language: 'en' } })
  try {
    await reopened.page.locator('.mu-embedded-video button').first().click()
    await expect(reopened.page.locator('.embedded-video-player')).toHaveJSProperty('videoWidth', 32)
  } finally {
    await reopened.app.close()
  }
})

test('linked by default, video embedding can be enabled independently and persists', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Start', {
    preferences: { language: 'en', imageInsertAction: 'path' },
    suppressErrorDialog: true
  })
  try {
    const video = join(dirname(filePath), title)
    writeFileSync(video, bytes)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [file] })
    }, video)
    await page.bringToFront()
    await page.locator('.mu-paragraph-content').first().click()
    await clickMenuById(app, 'videoMenuItem')
    const chip = page.locator('.mu-embedded-video button').first()
    await expect(chip).toBeVisible()
    await chip.click()
    const player = page.locator('.embedded-video-player')
    await expect(player).toHaveJSProperty('videoWidth', 32)
    await page.keyboard.press('Escape')
    let text = await getMarkdownContent(page, app)
    expect(text).not.toContain('data:video/')
    expect(text).toContain('sample%20%26%20clip.webm')
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await opened
    await settings.getByText('Video', { exact: true }).first().click()
    const toggle = settings.locator('#setting-embedVideos').getByRole('switch')
    await expect(toggle).not.toBeChecked()
    await settings.bringToFront()
    await toggle.locator('..').click()
    await expect(toggle).toBeChecked()
    await expect
      .poll(
        async() =>
          JSON.parse(
            readFileSync(
              join(await app.evaluate(({ app }) => app.getPath('userData')), 'preferences.json'),
              'utf8'
            )
          ).embedVideos
      )
      .toBe(true)
    const settingsWindow = await app.browserWindow(settings)
    await settingsWindow.evaluate((win) => win.close())
    await page.bringToFront()
    await enterSourceMode(page, app)
    await page.locator('.CodeMirror').click()
    await page.keyboard.press('Control+End')
    expect(
      await app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('videoMenuItem')?.enabled
      )
    ).toBe(true)
    await clickMenuById(app, 'videoMenuItem')
    await expect.poll(() => getMarkdownContent(page, app)).toContain(source)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(markup)
    await exitSourceMode(page, app)
    text = await getMarkdownContent(page, app)
    expect(text).toContain(markup)
  } finally {
    await app.close()
  }
})

test('a native MP4 drag over blank space in an untitled editor inserts a playable file link', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Start', { preferences: { language: 'en', compactVideoMaxHeight: 320 } })
  try {
    const filename = '#拖入 测试.mp4'
    const path = join(dirname(filePath), filename)
    copyFileSync(join(__dirname, 'data', 'portrait.mp4'), path)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'Untitled draft')
    await expect(page.locator('.mu-paragraph-content').first()).toHaveText('Untitled draft')
    const session = await page.context().newCDPSession(page)
    const editor = page.locator('.editor-component')
    const box = await editor.boundingBox()
    if (!box) throw new Error('Editor is missing')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const data = { items: [], files: [path], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver'] as const) {
      await session.send('Input.dispatchDragEvent', { type, ...point, data })
    }
    await expect(page.locator('.drop-container')).toBeHidden()
    await session.send('Input.dispatchDragEvent', { type: 'drop', ...point, data })
    const player = editor.locator('video')
    await expect(player).toHaveCount(1)
    await expect(player).toHaveJSProperty('videoHeight', 360)
    await expect.poll(() => player.evaluate(el => el.clientHeight)).toBe(320)
    const markdown = await getMarkdownContent(page, app)
    expect(markdown).toContain('src="file:///')
    expect(markdown).toContain(encodeURIComponent(filename))
  } finally {
    await app.close()
  }
})

test('dropping and pasting video files embeds the original bytes in both editors', async() => {
  const imported = Buffer.concat([bytes, Buffer.alloc(96 * 1024)]).toString('base64')
  const { app, page, filePath } = await launchWithMarkdown('Start', {
    preferences: { language: 'en', embedVideos: true, imageInsertAction: 'path' }
  })
  try {
    for (const mode of ['wysiwyg', 'source']) {
      if (mode === 'source') await enterSourceMode(page, app)
      const editor = page
        .locator(mode === 'source' ? '.CodeMirror' : '.mu-paragraph-content')
        .first()
      await editor.click()
      for (const action of ['drop', 'paste']) {
        await editor.evaluate(
          (node, payload) => {
            const transfer = new DataTransfer()
            const data = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0))
            const type = payload.action === 'drop' ? 'application/octet-stream' : 'video/webm'
            transfer.items.add(new File([data], 'clip.webm', { type }))
            const rect = node.getBoundingClientRect()
            const event =
              payload.action === 'drop'
                ? new DragEvent('drop', {
                  dataTransfer: transfer,
                  clientX: rect.x + 2,
                  clientY: rect.y + 2,
                  bubbles: true,
                  cancelable: true
                })
                : new ClipboardEvent('paste', {
                  clipboardData: transfer,
                  bubbles: true,
                  cancelable: true
                })
            node.dispatchEvent(event)
          },
          { data: imported, action }
        )
        const count = (mode === 'source' ? 2 : 0) + (action === 'drop' ? 1 : 2)
        await expect(
          page.locator(mode === 'source' ? '.embedded-video-chip' : '.mu-embedded-video')
        ).toHaveCount(count)
      }
    }
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8').split('data:video/webm;base64,' + imported).length).toBe(5)
  } finally {
    await app.close()
  }
})

for (const mode of ['wysiwyg', 'source']) {
  test(`existing embedded video in ${mode} plays with embedding off, edits and undoes, and drags out original bytes`, async() => {
    const { app, page } = await launchWithMarkdown(markup, {
      preferences: { language: 'en' },
      suppressErrorDialog: true
    })
    try {
      if (mode === 'source') await enterSourceMode(page, app)
      const target = page
        .locator(mode === 'source' ? '.embedded-video-chip' : '.mu-embedded-video button')
        .first()
      await target.click()
      const player = page.locator('.embedded-video-player')
      await expect(player).toHaveJSProperty('videoHeight', 24)
      await player.evaluate(async(el) => {
        const video = el as HTMLVideoElement
        video.muted = true
        await video.play()
        video.pause()
        video.currentTime = 0.2
      })
      await expect
        .poll(() => player.evaluate((el) => (el as HTMLVideoElement).currentTime))
        .toBeCloseTo(0.2)
      await page.getByRole('tab', { name: 'Embedded source' }).click()
      const field = page.locator('#embedded-data')
      await expect(field).toHaveValue(source)
      await field.fill('data:video/webm;base64,AA==')
      await page.getByRole('button', { name: 'Apply changes' }).click()
      await expect(page.locator('.embedded-image-workspace [role=alert]')).toBeVisible()
      const alternate = 'data:video/webm;charset=utf-8;base64,' + bytes.toString('base64')
      await field.fill(alternate)
      await page.getByRole('button', { name: 'Apply changes' }).click()
      await page.getByRole('tab', { name: 'Video preview' }).click()
      await expect(player).toHaveAttribute('src', alternate)
      await clickMenuById(app, 'undoMenuItem')
      await expect(player).toHaveAttribute('src', source)
      await player.evaluate((node, base64) => {
        const transfer = new DataTransfer()
        const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        transfer.items.add(new File([data], 'new.webm', { type: 'video/webm' }))
        node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true, bubbles: true }))
      }, Buffer.concat([bytes, Buffer.from([0xec, 0x81, 0])]).toString('base64'))
      await expect(player).not.toHaveAttribute('src', source)
      await clickMenuById(app, 'undoMenuItem')
      await expect(player).toHaveAttribute('src', source)
      await page.keyboard.press('Escape')
      const captured = await app.evaluateHandle(({ BrowserWindow, clipboard }) => {
        const state = { file: '', uri: '' }
        BrowserWindow.getAllWindows()[0].webContents.startDrag = (item) => {
          state.file = item.file ?? ''
        }
        clipboard.write = async(items) => {
          state.uri = await (await items[0].getType('text/uri-list')).text()
        }
        return state
      })
      await target.hover()
      const rect = await target.boundingBox()
      if (!rect) throw new Error('Missing video widget')
      await page.mouse.down()
      await page.mouse.move(rect.x + rect.width + 16, rect.y, { steps: 6 })
      await page.mouse.up()
      await expect.poll(() => captured.evaluate((s) => s.file)).toContain(title)
      expect(readFileSync(await captured.evaluate((s) => s.file))).toEqual(bytes)
      await chooseAction(app, target, 'Copy video file')
      await expect.poll(() => captured.evaluate((s) => s.uri)).toMatch(/^file:/)
      expect(readFileSync(new URL(await captured.evaluate((s) => s.uri)))).toEqual(bytes)
      await target.click()
      const output = test.info().outputPath(mode + '.webm')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async() => ({ canceled: false, filePath })
      }, output)
      await chooseAction(app, player, 'Save video as…')
      await expect
        .poll(() => {
          try {
            return readFileSync(output).equals(bytes)
          } catch {
            return false
          }
        })
        .toBe(true)
      await page.keyboard.press('Escape')
      await chooseAction(app, target, 'Convert to local video')
      if (mode === 'wysiwyg') {
        const preview = page.locator('.mu-embedded-video video').first()
        await expect(preview).toHaveAttribute('src', /assets\/[^/]+\.webm$/)
      }
      await expect.poll(() => getMarkdownContent(page, app)).not.toContain('data:video/')
    } finally {
      await app.close()
    }
  })
}
