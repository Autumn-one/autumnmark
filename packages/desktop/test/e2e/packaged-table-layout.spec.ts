import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const executable = process.env.AUTUMNMARK_PACKAGED_EXE
const fullWidth = '.mu-table-inner { width: 100%; }'
const plainTable = '| First column | Last column |\n| --- | --- |\n| Notes | Details |\n'
const sizedTable = '<!-- table-layout: col-widths="1:395,2:240,3:100%" row-min-heights="1:52" -->\n\n' +
  '| | | |\n| --- | --- | --- |\n| | | |\n| | | |\n| | | |\n'

for (const [title, css, markdown] of [
  ['default CSS', '', plainTable],
  ['full-width custom CSS', fullWidth, plainTable],
  ['a saved fill column and full-width custom CSS', fullWidth, sizedTable]
]) {
  test(`packaged table resize with ${title}`, async({ playwright }, info) => {
    test.skip(!executable, 'Requires the Windows release executable')
    const profile = info.outputPath('profile')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'preferences.json'), JSON.stringify({
      customCss: css, autoSave: true, autoSaveDelay: 1000
    }))
    const file = info.outputPath('table.md')
    writeFileSync(file, markdown)
    const proc = spawn(executable!, ['--user-data-dir', profile, '--remote-debugging-port=0', file], { stdio: 'ignore' })
    try {
      const portFile = join(profile, 'DevToolsActivePort')
      await expect.poll(() => existsSync(portFile), { timeout: 15000 }).toBe(true)
      const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0]
      // Packaged apps disable Node inspection. Drive the shipped renderer through Chromium.
      const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      try {
        const context = browser.contexts()[0]
        const page = context.pages()[0] ?? await context.waitForEvent('page')
        const grid = page.locator('.mu-table-inner')
        const last = grid.locator('tr').first().locator('td').last()
        await expect(last).toBeVisible()
        expect(page.url()).toContain('app.asar')
        if (css) await expect(page.locator('#custom-styles')).toHaveText(css)
        const start = await last.boundingBox()
        if (!start) throw new Error('Missing last column')
        if (css) {
          const figure = await page.locator('.mu-table').boundingBox()
          const table = await grid.boundingBox()
          expect(Math.abs(figure!.width - table!.width)).toBeLessThanOrEqual(1)
        }
        const x = start.x + start.width - 1
        const y = start.y + start.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        const delta = Math.min(24, Math.floor(start.width) - 36)
        expect(delta).toBeGreaterThan(0)
        await page.mouse.move(x - delta, y, { steps: 5 })
        const during = await last.boundingBox()
        if (!during) throw new Error('Lost table during resize')
        expect(Math.abs(during.x + during.width - (start.x + start.width - delta))).toBeLessThanOrEqual(1)
        expect(Math.abs(during.x - start.x)).toBeLessThanOrEqual(1)
        await page.mouse.up()
        const count = await grid.locator('tr').first().locator('td').count()
        await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10000 }).toContain(`${count}:${Math.round(start.width) - delta}"`)
        await page.reload()
        await expect(last).toBeVisible()
        const end = await last.boundingBox()
        expect(Math.abs(end!.x - during.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(end!.width - during.width)).toBeLessThanOrEqual(1)
      } finally {
        await browser.close()
      }
    } finally {
      proc.kill()
    }
  })
}
