import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, enterSourceMode, launchWithMarkdown } from './helpers'
import type { MenuTemplate } from '../../src/shared/types/menu'

function svg(width: number, height: number) {
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="teal"/></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(image).toString('base64')
}

for (const mode of ['wysiwyg', 'source']) {
  test(`sets exact embedded picture dimensions, resets to auto and undoes in ${mode}`, async() => {
    const data = svg(100, 50)
    const { app, page, filePath } = await launchWithMarkdown(`before ![leaf](${data} "Caption") after`, { preferences: { language: 'en' } })
    try {
      if (mode === 'source') await enterSourceMode(page, app)
      const target = page.locator(mode === 'source' ? '.CodeMirror .embedded-image-chip' : '.mu-embedded-picture img')
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeAllListeners('mt::menu::popup')
        ipcMain.on('mt::menu::popup', (event, template: MenuTemplate) => {
          const size = template.find(item => item.label === 'Set image size…')
          if (size) event.sender.send('mt::menu::click', { id: size.id })
          event.sender.send('mt::menu::closed', {})
        })
      })
      await target.click({ button: 'right' })
      const form = page.locator('.picture-size')
      const width = form.getByRole('spinbutton').first()
      const height = form.getByRole('spinbutton').last()
      await expect(width).toBeFocused()
      await expect(page.locator('.embedded-image-preview')).toHaveJSProperty('naturalWidth', 100)
      await width.fill('150')
      await expect(height).toHaveValue('75')
      await form.getByRole('checkbox').uncheck()
      await height.fill('92')
      await form.locator('[type=submit]').click()
      await expect(form).toHaveCount(0)
      await clickMenuById(app, 'fileSaveMenuItem')
      const saved = () => readFileSync(filePath, 'utf8')
      await expect.poll(saved).toContain('height="92"')
      expect(saved()).toContain('width="150"')
      expect(saved()).toContain(data)
      expect(saved()).toContain('title="Caption"')
      expect(saved()).toContain('alt="leaf"')
      await target.click()
      await expect(width).toHaveValue('150')
      await form.getByRole('button', { name: 'Restore automatic size' }).click()
      await form.locator('[type=submit]').click()
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(saved).not.toContain('width=')
      expect(saved()).not.toContain('height=')
      await clickMenuById(app, 'undoMenuItem')
      await target.click()
      await expect(width).toHaveValue('150')
      await expect(height).toHaveValue('92')
    } finally {
      await app.close()
    }
  })
}

test('shows live sizes and snaps to the width or height of a picture on the same row only while Shift is held', async() => {
  const { app, page, filePath } = await launchWithMarkdown(
    `![target](${svg(120, 60)}) ![peer](${svg(170, 100)})  \n![another row](${svg(197, 84)})`, { preferences: { language: 'en' } }
  )
  try {
    const pics = page.locator('.mu-embedded-picture img')
    await pics.first().hover()
    const handle = page.locator('.mu-transformer .right')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    if (!box) throw new Error('Missing hover handle')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const size = page.locator('.mu-image-size-readout')
    await page.mouse.move(x, y)
    await page.mouse.down()
    await expect(size).toContainText('120 × 60 px')
    await page.mouse.move(x + 77, y)
    await expect(pics.first()).toHaveAttribute('width', '197')
    await page.keyboard.down('Shift')
    await expect(size).toHaveText('200 × 100 px · Same height')
    await expect(pics.nth(1)).toHaveClass(/mu-image-snap-target/)
    await page.keyboard.up('Shift')
    await expect(pics.first()).toHaveAttribute('width', '197')
    await expect(page.locator('.mu-image-snap-target')).toHaveCount(0)
    await page.keyboard.down('Shift')
    await page.mouse.move(x + 48, y)
    await expect(size).toHaveText('170 × 85 px · Same width')
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect(size).toHaveCount(0)
    await expect(page.locator('.mu-image-snap-target')).toHaveCount(0)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('width="170"')
  } finally {
    await app.close()
  }
})
