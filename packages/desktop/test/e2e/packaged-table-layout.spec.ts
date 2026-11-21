import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const executable = process.env.AUTUMNMARK_PACKAGED_EXE
const fullWidth = '.mu-table-inner { width: 100%; }'

for (const css of ['', fullWidth]) {
  test(`packaged table resize with ${css ? 'full-width custom CSS' : 'default CSS'}`, async({ playwright }, info) => {
    test.skip(!executable, 'Requires the Windows release executable')
    const profile = info.outputPath('profile')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'preferences.json'), JSON.stringify({ customCss: css }))
    const file = info.outputPath('table.md')
    writeFileSync(file, '| First column | Last column |\n| --- | --- |\n| Notes | Details |\n')
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
        await page.mouse.move(x - 24, y, { steps: 5 })
        const during = await last.boundingBox()
        if (!during) throw new Error('Lost table during resize')
        expect(Math.abs(during.x + during.width - (start.x + start.width - 24))).toBeLessThanOrEqual(1)
        expect(Math.abs(during.x - start.x)).toBeLessThanOrEqual(1)
        await page.mouse.up()
        await page.keyboard.press('Control+s')
        await expect.poll(() => readFileSync(file, 'utf8')).toContain('<!-- table-layout:')
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
