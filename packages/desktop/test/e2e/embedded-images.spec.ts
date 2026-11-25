import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ElectronApplication, Locator } from 'playwright'
import type { MenuTemplate } from '../../src/shared/types/menu'
import { clickMenuById, enterSourceMode, exitSourceMode, getMarkdownContent, launchWithDoc, launchWithMarkdown } from './helpers'

const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAAdSURBVDhPY5Cb8P8/JZgBXYBUPGrAqAGjBgwWAwAsZKwfgyie3AAAAABJRU5ErkJggg=='
const src = 'data:image/png;base64,' + png

test('dragging a fitted preview image pans it inside the dialog', async() => {
  const { app, page } = await launchWithMarkdown(`![square](${src})`)
  try {
    await page.locator('.mu-embedded-image').click()
    const preview = page.locator('.embedded-image-preview')
    await expect(preview).toHaveJSProperty('naturalWidth', 16)
    await preview.hover()
    const box = await preview.boundingBox()
    if (!box) throw new Error('Missing preview image')
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height / 2)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y + 35, { steps: 6 })
    await expect(page.locator('.drop-hint')).toBeHidden()
    await page.mouse.up()
    await expect.poll(() => preview.evaluate(element => {
      const { m41, m42 } = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return [m41, m42]
    })).toEqual([60, 35])
    await expect(preview).toHaveAttribute('src', src)
  } finally {
    await app.close()
  }
})

test('opens a compact portrait image from either side of the picture', async() => {
  const portrait = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="800"><rect width="180" height="800" fill="navy"/></svg>')
  const source = 'data:image/svg+xml;base64,' + portrait.toString('base64')
  const { app, page } = await launchWithMarkdown(`![Portrait](${source})`, { preferences: { language: 'en', compactImageMaxHeight: 320 } })
  try {
    const viewport = page.locator('.mu-paragraph-content.mu-compact-limited')
    const preview = page.locator('.embedded-image-preview')
    const toggle = page.locator('.mu-compact-toggle')
    const badge = viewport.locator('.mu-embedded-picture-badge')
    const badgePosition = () => badge.evaluate(el => {
      const rect = el.getBoundingClientRect()
      const viewport = el.closest('.mu-paragraph-content')!.getBoundingClientRect()
      const picture = el.previousElementSibling!.getBoundingClientRect()
      return [Math.round(rect.top - viewport.top), Math.round(picture.right - rect.right)]
    })
    await expect.poll(badgePosition).toEqual([2, 2])
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(200)
    await expect.poll(badgePosition).toEqual([2, 2])
    await viewport.evaluate(el => { el.scrollTop = 0 })
    for (const expanded of [false, true]) {
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      const { left, right, width } = await viewport.evaluate(el => {
        const portrait = el.querySelector('img')
        if (!portrait) throw new Error('Missing portrait image')
        const image = portrait.getBoundingClientRect()
        const left = image.left - el.getBoundingClientRect().left
        return { left, right: el.clientWidth - left - image.width, width: el.clientWidth }
      })
      expect(left).toBeGreaterThan(10)
      expect(Math.abs(left - right)).toBeLessThan(2)
      await viewport.click({ position: { x: expanded ? width - 5 : 5, y: 40 } })
      await expect(preview).toBeVisible()
      await expect(preview).toHaveAttribute('src', source)
      await preview.click()
      await expect(preview).toBeVisible()
      if (expanded) {
        const upperMask = await page.evaluate(() => {
          const dialog = document.querySelector('.embedded-image-dialog')!.getBoundingClientRect()
          return { x: Math.round(innerWidth / 2), y: Math.min(12, Math.floor(dialog.top / 2)) }
        })
        await expect(page.locator('.embedded-media-overlay')).toHaveCSS('app-region', 'no-drag')
        await page.mouse.click(upperMask.x, upperMask.y)
      } else {
        await page.locator('.image-stage').click({ position: { x: 2, y: 2 } })
      }
      await expect(preview).toBeHidden()
      await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(preview).toBeHidden()
  } finally {
    await app.close()
  }
})

test('embedded images survive save and mode changes and delete in one keystroke', async() => {
  test.setTimeout(60000)
  const markdown = `before ![dot](${src}) after`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { imageInsertAction: 'embed', language: 'en', theme: 'pine-ink', followSystemTheme: false }
  })
  try {
    const atom = page.locator('.mu-editor .mu-embedded-image')
    await expect(atom).toHaveCount(1)
    await expect(atom.locator('img')).toHaveJSProperty('naturalWidth', 16)
    await expect(page.locator('.mu-editor')).not.toContainText(png)
    await atom.click()
    await expect(page.locator('.embedded-image-preview')).toHaveAttribute('src', src)
    await page.keyboard.press('Escape')
    const placeAfterImage = () => atom.evaluate(node => {
      const range = document.createRange()
      range.setStartAfter(node)
      range.collapse(true)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    })
    await placeAfterImage()
    await page.keyboard.press('Backspace')
    await expect(atom).toHaveCount(0)
    await expect(page.locator('.mu-editor')).toContainText('before  after', { useInnerText: false })
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom).toHaveCount(1)
    await placeAfterImage()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Delete')
    await expect(atom).toHaveCount(0)
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom).toHaveCount(1)

    await enterSourceMode(page, app)
    const chip = page.locator('.CodeMirror .embedded-image-chip')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(page.locator('.CodeMirror-code')).not.toContainText(png)
    expect((await getMarkdownContent(page, app)).trim()).toBe(markdown)
    await page.locator('.CodeMirror').evaluate(node => {
      const cm = (node as HTMLElement & { CodeMirror?: CodeMirror.Editor }).CodeMirror
      if (!cm) throw new Error('Source editor is unavailable')
      cm.focus()
      cm.setCursor({ line: 0, ch: 'before '.length })
    })
    await page.keyboard.press('Delete')
    expect((await getMarkdownContent(page, app)).trim()).toBe('before  after')
    await clickMenuById(app, 'undoMenuItem')
    await expect(chip).toHaveCount(1)
    await chip.click()
    await expect(page.locator('.embedded-image-preview')).toBeVisible()
    await page.locator('.embedded-image-dialog .el-dropdown__caret-button').click()
    await page.getByRole('menuitem', { name: 'Delete image', exact: true }).click()
    expect((await getMarkdownContent(page, app)).trim()).toBe('before  after')
    await page.locator('.CodeMirror').evaluate((node, data) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'blue.png', { type: 'image/png' }))
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
    }, png)
    await expect(chip).toHaveCount(1)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(`![blue.png](${src})`)
    await exitSourceMode(page, app)
    await expect(atom.locator('img')).toHaveAttribute('src', src)
  } finally {
    await app.close()
  }
})

test('paste, drop and replace embedded images without changing the original bytes', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Paragraph', { preferences: { imageInsertAction: 'embed' } })
  try {
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('End')
    const transferImage = async(selector: string, action: 'drop' | 'paste') => {
      await page.locator(selector).first().evaluate((node, { data, action }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'dot.png', { type: 'image/png' }))
        const { x, y } = node.getBoundingClientRect()
        const event = action === 'drop'
          ? new DragEvent('drop', { dataTransfer: transfer, clientX: x + 2, clientY: y + 2, cancelable: true, bubbles: true })
          : new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true, bubbles: true })
        node.dispatchEvent(event)
      }, { data: png, action })
    }
    const atom = page.locator('.mu-embedded-image')
    await transferImage('.mu-paragraph-content', 'paste')
    await expect(atom).toHaveCount(1)
    await transferImage('.mu-paragraph-content', 'drop')
    await expect(atom).toHaveCount(2)
    await enterSourceMode(page, app)
    await expect(page.locator('.embedded-image-chip')).toHaveCount(2)
    await transferImage('.CodeMirror-code', 'drop')
    await expect(page.locator('.embedded-image-chip')).toHaveCount(3)
    const replacement = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2D canvas is unavailable')
      const pixels = ctx.createImageData(canvas.width, canvas.height)
      for (let pos = 0; pos < pixels.data.length; pos += 16384)
        crypto.getRandomValues(pixels.data.subarray(pos, pos + 16384))
      ctx.putImageData(pixels, 0, 0)
      return canvas.toDataURL()
    })
    expect(replacement.length).toBeGreaterThan(1_000_000)
    await page.locator('.embedded-image-chip').first().click()
    await page.locator('.el-dialog:visible input[type=file]').setInputFiles({
      name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1], 'base64')
    })
    await expect(page.locator('.embedded-image-preview')).toHaveAttribute('src', replacement)
    await page.keyboard.press('Escape')
    await expect(page.locator('.CodeMirror-code')).not.toContainText(replacement.slice(30, 90))
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8').includes(replacement)).toBe(true)
    await exitSourceMode(page, app)
    await expect(atom).toHaveCount(3)
    await expect(atom.first().locator('img')).toHaveJSProperty('naturalWidth', 640)
    await expect(page.locator('.mu-editor')).not.toContainText(replacement.slice(30, 90))
  } finally {
    await app.close()
  }
})

async function selectImageAction(app: ElectronApplication, target: Locator, label: string) {
  await app.evaluate(({ ipcMain }, label) => {
    ipcMain.removeAllListeners('mt::menu::popup')
    ipcMain.on('mt::menu::popup', (event, template: MenuTemplate) => {
      const items = template.flatMap(item => [item, ...(item.submenu ?? [])])
      const match = items.find(item => item.label === label && item.enabled)
      if (match) event.sender.send('mt::menu::click', { id: match.id })
      event.sender.send('mt::menu::closed', {})
    })
  }, label)
  await target.click({ button: 'right' })
}

test('resizes an embedded picture from either edge without opening its preview', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`Before ![leaf](${src} "Leaf title") after`)
  try {
    const picture = page.locator('.mu-embedded-image img')
    for (const [edge, delta] of [['right', 80], ['left', -35]] as const) {
      await picture.hover()
      const handle = page.locator('.mu-transformer .' + edge)
      await expect(handle).toBeVisible()
      const box = (await handle.boundingBox())!
      const width = (await picture.boundingBox())!.width
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + delta, y, { steps: 5 })
      await page.mouse.up()
      await expect(picture).toHaveAttribute('width', String(Math.floor(width + Math.abs(delta))))
      await expect(page.locator('.embedded-image-dialog:visible')).toHaveCount(0)
    }
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('width="131"')
    expect(readFileSync(filePath, 'utf8')).toContain(src)
    await picture.click()
    await expect(page.locator('.embedded-image-preview')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('aligns mixed pictures at the top and resizes a linked picture on hover alone', async() => {
  const filePath = test.info().outputPath('pictures.md')
  writeFileSync(test.info().outputPath('leaf.png'), Buffer.from(png, 'base64'))
  writeFileSync(filePath, `![one](${src})\u3000<img src="leaf.png" width="79" alt="two" />\u3000![three](leaf.png)`)
  const { app, page } = await launchWithDoc(filePath, { preferences: { compactMode: true, compactImageMaxHeight: 50, language: 'en' } })
  try {
    const pictures = page.locator('.mu-content img')
    await expect(pictures).toHaveCount(3)
    await expect.poll(() => pictures.evaluateAll(nodes => {
      const tops = nodes.map(node => node.getBoundingClientRect().top)
      return Math.max(...tops) - Math.min(...tops)
    })).toBeLessThan(1)
    for (const picture of await pictures.all()) {
      const chrome = await picture.evaluate(node => {
        const wrapper = node.closest('.mu-inline-image, .mu-embedded-picture')
        if (!wrapper) throw new Error('Missing rendered picture')
        const style = getComputedStyle(wrapper)
        return [style.backgroundColor, style.borderTopWidth, style.paddingTop, style.verticalAlign]
      })
      expect(chrome).toEqual(['rgba(0, 0, 0, 0)', '0px', '0px', 'top'])
    }
    await expect(page.locator('.mu-embedded-picture')).toHaveText('')
    await expect(page.locator('.mu-embedded-picture-badge')).toHaveCount(1)
    await expect(page.locator('.mu-embedded-picture-badge')).toHaveAttribute('title', 'Embedded in this document')
    await expect(page.locator('.mu-compact-toggle')).toHaveCount(0)
    await pictures.first().hover()
    await expect(page.locator('.mu-transformer .right')).toBeVisible()
    await pictures.first().click()
    await expect(page.locator('.embedded-image-preview')).toBeVisible()
    await page.keyboard.press('Escape')
    await pictures.nth(1).hover()
    await expect(page.locator('.mu-inline-image-selected')).toHaveCount(0)
    const handle = page.locator('.mu-transformer .right')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    if (!box) throw new Error('Missing hover resize handle')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 24, y, { steps: 5 })
    await page.mouse.up()
    await expect(pictures.nth(1)).toHaveAttribute('width', '103')
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('width="103"')
    expect(readFileSync(filePath, 'utf8')).toContain('![three](leaf.png)')
    await clickMenuById(app, 'undoMenuItem')
    await expect(pictures.nth(1)).toHaveAttribute('width', '79')
  } finally {
    await app.close()
  }
})

test('resizing across the compact height limit keeps the saved width and reachable handles', async() => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"/>').toString('base64')
  const { app, page, filePath } = await launchWithMarkdown(`<img src="data:image/svg+xml;base64,${svg}" alt="portrait" width="70" />`, {
    preferences: { compactMode: true, compactImageMaxHeight: 160, language: 'en' }
  })
  try {
    const picture = page.locator('.mu-embedded-picture img')
    const viewport = page.locator('.mu-paragraph-content').filter({ has: picture })
    const toggle = page.locator('.mu-compact-toggle')
    const handle = page.locator('.mu-transformer .right')
    const drag = async(delta: number) => {
      await picture.hover({ position: { x: 6, y: 10 } })
      await expect(handle).toBeVisible()
      const box = await handle.boundingBox()
      if (!box) throw new Error('Missing resize handle')
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + delta, y, { steps: 5 })
    }
    await expect(toggle).toHaveCount(0)
    await drag(130)
    await expect.poll(() => viewport.evaluate(el => el.clientHeight)).toBe(160)
    await expect.poll(() => page.evaluate(() => {
      const cropped = document.querySelector('.mu-compact-limited')!.getBoundingClientRect()
      const bar = document.querySelector('.mu-transformer .right')!.getBoundingClientRect()
      return bar.top >= cropped.top - 1 && bar.bottom <= cropped.bottom + 1
    })).toBe(true)
    await page.mouse.up()
    await expect(picture).toHaveAttribute('width', '200')
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('width="200"')
    await toggle.click()
    await expect.poll(() => viewport.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(400)
    await toggle.click()
    await drag(-130)
    await page.mouse.up()
    await expect(picture).toHaveAttribute('width', '70')
    await expect(toggle).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('embeds only the right-clicked occurrence and preserves its size and caption', async() => {
  const file = test.info().outputPath('leaf.png')
  writeFileSync(file, Buffer.from(png, 'base64'))
  const local = pathToFileURL(file).href
  const markdown = `![embedded](${src}) ![first](${local}) <img src="${local}" width="93" alt="second" title="Leaf title" />`
  const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { language: 'en' } })
  try {
    const target = page.locator('.mu-inline-image img').last()
    await selectImageAction(app, target, 'Embed this image')
    await expect(page.locator('.mu-embedded-image img')).toHaveCount(2)
    await expect(page.locator('.mu-embedded-image img').last()).toHaveAttribute('width', '93')
    await clickMenuById(app, 'fileSaveMenuItem')
    const saved = () => readFileSync(filePath, 'utf8')
    await expect.poll(saved).toContain(`<img src="${src}" width="93" alt="second" title="Leaf title" />`)
    expect(saved()).toContain(`![first](${local})`)
    await clickMenuById(app, 'undoMenuItem')
    await expect(page.locator('.mu-inline-image')).toHaveCount(2)
  } finally {
    await app.close()
  }
})

test('hover resizing a reference image keeps the shared definition for other uses', async() => {
  const filePath = test.info().outputPath('references.md')
  writeFileSync(test.info().outputPath('leaf.png'), Buffer.from(png, 'base64'))
  writeFileSync(filePath, '![first][leaf] ![second][leaf]\n\n[leaf]: leaf.png "Caption"')
  const { app, page } = await launchWithDoc(filePath)
  try {
    const pictures = page.locator('.mu-image-marked-text + img')
    await expect(pictures).toHaveCount(2)
    await pictures.last().hover()
    const handle = page.locator('.mu-transformer .right')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    if (!box) throw new Error('Missing reference image handle')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y, { steps: 4 })
    await page.mouse.up()
    await expect(page.locator('.mu-inline-image img[alt="second"]')).toHaveAttribute('width', '76')
    await expect(pictures).toHaveCount(1)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('width="76"')
    const saved = readFileSync(filePath, 'utf8')
    expect(saved).toContain('![first][leaf]')
    expect(saved).toContain('[leaf]: leaf.png "Caption"')
  } finally {
    await app.close()
  }
})

async function expectPaintedImageCaret(caret: Locator) {
  await expect(caret).toHaveCount(1)
  await expect.poll(() => caret.evaluate(el => {
    const style = getComputedStyle(el, '::after')
    return style.width === '2px' && Number.parseFloat(style.height) >= 10 && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
  })).toBe(true)
}

test('paints the insertion caret and types on both sides of the final picture', async() => {
  const { app, page } = await launchWithMarkdown(`![embedded](${src})![last](${src})`)
  try {
    const paragraph = page.locator('.mu-paragraph-content').first()
    const pictures = paragraph.locator('.mu-embedded-image')
    await expect(pictures).toHaveCount(2)
    for (const edge of ['end', 'start']) {
      await paragraph.evaluate((node, side) => {
        const picture = node.querySelectorAll('.mu-embedded-image')[1]
        const range = document.createRange()
        if (side === 'start') range.setStartBefore(picture)
        else range.setStartAfter(picture)
        range.collapse(true)
        ;(node as HTMLElement).focus()
        const selection = document.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      }, edge)
      const caret = paragraph.locator(`.mu-inline-image-caret[data-mu-image-caret="${edge}"]`)
      await expectPaintedImageCaret(caret)
      await page.keyboard.type(edge === 'start' ? 'between' : 'after')
    }
    expect((await getMarkdownContent(page, app)).trim()).toBe(`![embedded](${src})between![last](${src})after`)
  } finally {
    await app.close()
  }
})

test('moves from a selected local picture to a visible, editable boundary beside an embedded picture', async() => {
  const file = test.info().outputPath('leaf.png')
  writeFileSync(file, Buffer.from(png, 'base64'))
  const local = pathToFileURL(file).href
  const { app, page } = await launchWithMarkdown(`![first](${src})![last](${local})`)
  try {
    const last = page.locator('.mu-inline-image img')
    for (const [key, edge, text] of [['ArrowLeft', 'start', 'between'], ['ArrowRight', 'end', 'after']] as const) {
      await last.click()
      await page.keyboard.press(key)
      const caret = page.locator(`.mu-inline-image-caret[data-mu-image-caret="${edge}"]`)
      await expectPaintedImageCaret(caret)
      await page.keyboard.type(text)
    }
    expect((await getMarkdownContent(page, app)).trim()).toBe(`![first](${src})between![last](${local})after`)
  } finally {
    await app.close()
  }
})

for (const mode of ['wysiwyg', 'source']) {
  test(`embeds all document images in one undo step in ${mode}`, async() => {
    const markdown = `![first](leaf.png "note")\n\n![again](leaf.png)\n\n![inline](${src})\n\nKeep \`![code](leaf.png)\`\n`
    const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { language: 'en' } })
    try {
      writeFileSync(join(dirname(filePath), 'leaf.png'), Buffer.from(png, 'base64'))
      if (mode === 'source') await enterSourceMode(page, app)
      const status = page.locator('.image-status-button')
      await expect(status).toHaveAttribute('aria-label', '2 images to embed')
      await status.click()
      await expect(page.locator('.image-details:visible')).toContainText('Embedded: 1 · Not embedded: 2')
      await expect(page.locator('.image-details:visible')).not.toContainText('leaf.png')
      if (mode === 'source') {
        await page.getByRole('button', { name: 'Embed all document images (2)' }).click()
      } else {
        await status.click()
        await app.evaluate(({ ipcMain }) => {
          ipcMain.removeAllListeners('mt::menu::popup')
          ipcMain.on('mt::menu::popup', (event, template: MenuTemplate) => {
            const item = template.find(item => item.id?.startsWith('embedDocumentImages-') && item.enabled)
            if (item) event.sender.send('mt::menu::click', { id: item.id })
            event.sender.send('mt::menu::closed', {})
          })
        })
        await page.locator('.mu-editor').dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
      }
      await expect(status).toHaveAttribute('aria-label', 'All images embedded')
      await status.click()
      await expect(page.locator('.image-details:visible')).toHaveText('Document imagesEmbedded: 3 · Not embedded: 0')
      await status.click()
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(`![first](${src} "note")`)
      expect(readFileSync(filePath, 'utf8')).toContain('`![code](leaf.png)`')
      await clickMenuById(app, 'undoMenuItem')
      await expect(status).toHaveAttribute('aria-label', '2 images to embed')
    } finally {
      await app.close()
    }
  })
}

test('saves the original local image from the preview menu', async() => {
  const file = test.info().outputPath('linked picture.png')
  const saved = test.info().outputPath('saved picture.png')
  writeFileSync(file, Buffer.from(png, 'base64'))
  const { app, page } = await launchWithMarkdown(`![linked](${pathToFileURL(file).href})`, {
    preferences: { language: 'en' }
  })
  try {
    await page.locator('.mu-inline-image img').click({ modifiers: ['ControlOrMeta'] })
    const preview = page.locator('.image-viewer img')
    await expect(preview).toBeVisible()
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, saved)
    await selectImageAction(app, preview, 'Save image as…')
    await expect.poll(() => {
      try { return readFileSync(saved).toString('base64') } catch { return '' }
    }).toBe(png)
  } finally {
    await app.close()
  }
})

async function pasteDocument(target: Locator, content: string, format = 'text/plain') {
  await target.evaluate((node, { content, format }) => {
    const transfer = new DataTransfer()
    transfer.setData(format, content)
    const input = node.querySelector('textarea') ?? node
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  }, { content, format })
}

for (const mode of ['wysiwyg', 'source']) {
  test(`embeds both images from an HTML clipboard document in ${mode}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('Here ', { preferences: { imageInsertAction: 'embed' } })
    try {
      writeFileSync(join(dirname(filePath), 'square.png'), Buffer.from(png, 'base64'))
      if (mode === 'source') await enterSourceMode(page, app)
      const target = page.locator(mode === 'source' ? '.CodeMirror' : '.mu-paragraph-content').first()
      await target.click()
      await page.keyboard.press('End')
      await pasteDocument(target, '<p>First <img src="square.png" alt="first"></p><p>Second <img src="square.png" alt="second"></p>', 'text/html')
      await expect(page.locator(mode === 'source' ? '.embedded-image-chip' : '.mu-embedded-image')).toHaveCount(2)
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => readFileSync(filePath, 'utf8').split(src).length).toBe(3)
      expect(readFileSync(filePath, 'utf8')).toContain('Second')
    } finally { await app.close() }
  })

  test(`keeps pasted image paths in ${mode} when embedding is disabled`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('Here ', { preferences: { imageInsertAction: 'path' } })
    try {
      writeFileSync(join(dirname(filePath), 'square.png'), Buffer.from(png, 'base64'))
      if (mode === 'source') await enterSourceMode(page, app)
      const target = page.locator(mode === 'source' ? '.CodeMirror' : '.mu-paragraph-content').first()
      await target.click()
      await page.keyboard.press('End')
      const text = 'First ![one](square.png) second <img src="square.png">'
      await pasteDocument(target, text)
      await expect(target).toContainText('second')
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(text)
      await expect(page.locator('.image-paste-progress')).toHaveCount(0)
    } finally { await app.close() }
  })

  test(`edits, validates and undoes image replacements in ${mode}`, async() => {
    const { page, app } = await launchWithMarkdown(`![square](${src})`, { preferences: { language: 'en' } })
    try {
      if (mode === 'source') await enterSourceMode(page, app)
      const atom = page.locator(mode === 'source' ? '.CodeMirror-code .embedded-image-chip' : '.mu-embedded-image')
      await selectImageAction(app, atom, 'View embedded source')
      const field = page.getByRole('textbox', { name: 'Base64' })
      await expect(field).toHaveValue(src)
      await field.fill('data:image/png;base64,AA==')
      await page.getByRole('button', { name: 'Apply changes' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Could not read' })).toBeVisible()
      const replacement = await page.evaluate(() => document.createElement('canvas').toDataURL())
      await field.fill(replacement)
      await page.getByRole('tab', { name: 'Image preview' }).click()
      const preview = page.locator('.embedded-image-preview')
      await expect(preview).toHaveAttribute('src', src)
      await selectImageAction(app, preview, 'View embedded source')
      await expect(field).toHaveValue(replacement)
      await page.getByRole('button', { name: 'Apply changes' }).click()
      await page.getByRole('tab', { name: 'Image preview' }).click()
      await expect(preview).toHaveAttribute('src', replacement)
      await preview.hover()
      await page.mouse.wheel(0, -180)
      await expect(page.locator('.zoom output')).not.toHaveText('100%')
      await page.getByRole('button', { name: 'Fit to window' }).click()
      await page.locator('.image-stage').evaluate((stage, source) => {
        const transfer = new DataTransfer()
        transfer.setData('text/plain', source)
        stage.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
      }, src)
      await expect(preview).toHaveAttribute('src', src)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
      await expect(preview).toHaveAttribute('src', replacement)
      await app.evaluate(({ clipboard, ClipboardItem }, b64) => {
        clipboard.read = async() => [new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(Buffer.from(b64, 'base64'))], { type: 'image/png' }) })]
      }, png)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
      await expect(preview).toHaveAttribute('src', src)
      await clickMenuById(app, 'undoMenuItem')
      await expect(preview).toHaveAttribute('src', replacement)
      await page.keyboard.press('Escape')
      await clickMenuById(app, 'undoMenuItem')
      expect((await getMarkdownContent(page, app)).trim()).toBe(`![square](${src})`)
    } finally { await app.close() }
  })
}

test('downloads a remote image with default preferences and converts it to a relative local file', async() => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(Buffer.from(png, 'base64'))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { app, page, filePath } = await launchWithMarkdown('Here', { preferences: {
    language: 'en', imageRelativeDirectoryName: '${filename} assets'
  } })
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/picture.png'
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('End')
    await paragraph.evaluate((node, url) => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', url)
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, url)
    const atom = page.locator('.mu-embedded-image')
    await expect(atom.locator('img')).toHaveAttribute('src', src)
    await atom.click()
    const preview = page.locator('.embedded-image-preview')
    await selectImageAction(app, preview, 'Convert to local image')
    await expect(preview).toBeHidden()
    await expect(atom).toHaveCount(0)
    await clickMenuById(app, 'fileSaveMenuItem')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('%20assets/')
    const markdown = readFileSync(filePath, 'utf8')
    const destination = /!\[.*?\]\(([^)]+)\)/.exec(markdown)?.[1]
    expect(destination).toBeTruthy()
    expect(readFileSync(join(dirname(filePath), decodeURIComponent(destination!))).toString('base64')).toBe(png)
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom.locator('img')).toHaveAttribute('src', src)
    await enterSourceMode(page, app)
    const sourceEditor = page.locator('.CodeMirror')
    await sourceEditor.evaluate((node, url) => {
      const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror
      cm.setCursor({ line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length })
      const transfer = new DataTransfer()
      transfer.setData('text/plain', `![remote](${url} "Caption")`)
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, url)
    await expect.poll(() => getMarkdownContent(page, app)).toContain(`![remote](${src} "Caption")`)
  } finally {
    server.close()
    await app.close()
  }
})

test('hands the original file to native drag and offers PNG, JPEG and data URL copies', async() => {
  const { page, app } = await launchWithMarkdown(`![square](${src})`, { preferences: { language: 'en' } })
  try {
    const received = await app.evaluateHandle(({ BrowserWindow, clipboard }) => {
      const state = { file: '', type: '', value: '' }
      BrowserWindow.getAllWindows()[0].webContents.startDrag = item => { state.file = item.file ?? '' }
      clipboard.write = async items => {
        const type = items[0].types[0]
        const blob = await items[0].getType(type)
        if (blob instanceof Blob) {
          state.type = type
          state.value = Buffer.from(await blob.arrayBuffer()).subarray(0, 4).toString('hex')
        }
      }
      clipboard.writeText = async text => {
        state.type = 'text'
        state.value = text
      }
      return state
    })
    const atom = page.locator('.mu-embedded-image')
    const image = atom.locator('img')
    const rect = await image.boundingBox()
    if (!rect) throw new Error('Missing image')
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.down()
    await page.mouse.move(rect.x + 80, rect.y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => received.evaluate(state => state.file)).toMatch(/square\.png$/)
    const file = await received.evaluate(state => state.file)
    expect(readFileSync(file).toString('base64')).toBe(png)
    await selectImageAction(app, atom, 'Copy image')
    await expect.poll(() => received.jsonValue()).toMatchObject({ type: 'image/png', value: '89504e47' })
    await selectImageAction(app, atom, 'JPEG image')
    await expect.poll(() => received.jsonValue()).toMatchObject({ type: 'image/jpeg', value: expect.stringMatching(/^ffd8ff/) })
    await selectImageAction(app, atom, 'Base64 Data URL')
    await expect.poll(() => received.jsonValue()).toMatchObject({ type: 'text', value: src })
    const output = test.info().outputPath('export.jpg')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, output)
    await selectImageAction(app, atom, 'Save image as…')
    await expect.poll(() => {
      try { return readFileSync(output).subarray(0, 3).toString('hex') } catch { return '' }
    }).toBe('ffd8ff')
    await expect(image).toHaveAttribute('src', src)
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
    }, output)
    await selectImageAction(app, atom, 'Choose image…')
    await expect(atom.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
    await clickMenuById(app, 'undoMenuItem')
    await expect(atom.locator('img')).toHaveAttribute('src', src)
  } finally { await app.close() }
})

test('existing embedded images stay compact in references, literal code and HTML', async() => {
  const markdown = [
    '**Before** ![reference][pic]',
    `[pic]: ${src}`,
    `\`\`\`markdown\n![sample](${src})\n\`\`\``,
    `After <img width="12" alt="square" src="${src}"> end`
  ].join('\n\n')
  const { page, app } = await launchWithMarkdown(markdown, { preferences: { imageInsertAction: 'path' } })
  try {
    await expect(page.locator('.mu-embedded-image')).toHaveCount(3)
    await expect(page.locator('.mu-editor')).not.toContainText(png)
    await expect(page.locator('.mu-embedded-image img[alt=square]')).toHaveAttribute('width', '12')
    await enterSourceMode(page, app)
    await expect(page.locator('.embedded-image-chip')).toHaveCount(3)
    await expect(page.locator('.CodeMirror-code')).not.toContainText(png)
    expect((await getMarkdownContent(page, app)).trim()).toBe(markdown)
  } finally {
    await app.close()
  }
})

for (const mode of ['wysiwyg', 'source']) {
  test(`embeds a pasted image document in ${mode} while a web image is downloading`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('Keep ![existing](local%20pic.png)\n\nPaste here ', {
      preferences: { imageInsertAction: 'embed', language: 'en' }
    })
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const server = createServer(async(req, res) => {
      await pending
      if (req.url === '/missing') res.writeHead(404).end()
      else res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(png, 'base64'))
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
      writeFileSync(join(dirname(filePath), 'local pic.png'), Buffer.from(png, 'base64'))
      const text = [
        'Local ![one](local%20pic.png "Caption")',
        `Remote <img width="12" alt='two' src="${base}/image"> and ![again](${base}/image).`,
        `Keep ![failed](${base}/missing) and \`![sample](local%20pic.png)\`.`,
        '```markdown\n<img src="local%20pic.png">\n```',
        'End'
      ].join('\n\n')
      if (mode === 'source') await enterSourceMode(page, app)
      const target = page.locator(mode === 'source' ? '.CodeMirror' : '.mu-paragraph-content').last()
      await target.click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
      await pasteDocument(target, text)
      const progress = page.locator('.image-paste-progress')
      await expect(progress).toContainText('Embedding images 1/4')
      await page.keyboard.type(' typed')
      release()
      await expect(progress).toContainText('Kept original links for 1 of 4 images')
      if (mode === 'source') await expect(page.locator('.CodeMirror .embedded-image-chip')).toHaveCount(3)
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toContain(`![one](${src} "Caption")`)
      const saved = readFileSync(filePath, 'utf8')
      expect(saved).toContain(`<img width="12" alt='two' src="${src}">`)
      expect(saved).toContain(`![again](${src})`)
      expect(saved).toContain(`![failed](${base}/missing)`)
      expect(saved).toContain('![existing](local%20pic.png)')
      expect(saved).toContain('`![sample](local%20pic.png)`')
      expect(saved).toContain('<img src="local%20pic.png">')
      expect(saved).toContain('End typed')
    } finally {
      release()
      server.close()
      server.closeAllConnections()
      await app.close()
    }
  })
}
