import { createHash } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import type * as ElectronUpdater from 'electron-updater'
import type { ElectronApplication } from 'playwright'
import { expectNoRendererErrors, launchElectron } from './helpers'

test('keeps a download running while its progress dialog is in the background', async() => {
  test.skip(process.platform !== 'win32', 'Exercises the NSIS download provider')
  const payload = Buffer.alloc(2_000_000, 65)
  const file = { url: 'fixture.exe', size: payload.length, sha512: createHash('sha512').update(payload).digest('base64') }
  let packageRequests = 0
  let transfer: ServerResponse | undefined
  let sent = 0
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/latest.yml')) {
      res.end(JSON.stringify({ version: '99.0.0', files: [file], path: file.url, sha512: file.sha512 }))
      return
    }
    if (req.url?.startsWith('/fixture.exe')) {
      packageRequests++
      transfer = res
      res.writeHead(200, { 'Content-Length': payload.length })
      res.flushHeaders()
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  // Leave the last half pending until the user has put the download in the background.
  const tick = setInterval(() => {
    if (transfer && !transfer.writableEnded && sent < payload.length / 2) {
      transfer.write(payload.subarray(sent, sent + 25000))
      sent += 25000
    }
  }, 100)
  let app: ElectronApplication | undefined
  try {
    const launched = await launchElectron([], {
      preferences: { language: 'zh-CN', titleBarStyle: 'custom' },
      userDataFiles: { 'feed.yml': `provider: generic\nurl: ${url}\nupdaterCacheDirName: update-test\n` },
      suppressErrorDialog: true
    })
    app = launched.app
    const { page } = launched
    await app.evaluate(({ app }) => {
      const modules = process.getBuiltinModule('module')
      const require = modules.createRequire(`${app.getAppPath()}/package.json`)
      const { autoUpdater } = require('electron-updater') as typeof ElectronUpdater
      process.env.LOCALAPPDATA = app.getPath('userData')
      autoUpdater.updateConfigPath = `${app.getPath('userData')}/feed.yml`
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.disableDifferentialDownload = true
    })
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::check-for-update'))
    const dialog = page.getByRole('dialog', { name: '软件更新' })
    await expect(dialog).toBeVisible()
    const meter = dialog.getByRole('progressbar')
    await expect.poll(async() => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    await expect(dialog.locator('.update-details')).toContainText('MB')
    await dialog.getByRole('button', { name: '在后台继续' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: '软件更新' }).click()
    await expect(meter).toBeVisible()
    await dialog.getByRole('button', { name: '在后台继续' }).click()
    await expect(dialog).toBeHidden()
    expect(transfer).toBeDefined()
    transfer?.end(payload.subarray(sent))
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::check-for-update'))
    await expect(dialog.getByRole('button', { name: '重启并安装' })).toBeVisible()
    await expect(meter).toHaveAttribute('aria-valuenow', '100')
    await dialog.getByRole('button', { name: '稍后' }).click()
    await expect(dialog).toBeHidden()
    expect(packageRequests).toBe(1)
    await expectNoRendererErrors(app)
  } finally {
    clearInterval(tick)
    server.closeAllConnections()
    server.close()
    if (app) await app.close()
  }
})
