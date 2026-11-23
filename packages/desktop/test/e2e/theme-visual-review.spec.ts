import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

for (const requestType of ['chat-completions', 'responses']) {
  test(`the model chooses when and where to capture the preview using ${requestType}`, async() => {
    const responses = requestType === 'responses'
    const captures: string[] = []
    const sizes: { width: number; height: number; red: number; blue: number; outside: number }[] = []
    const firstLine = 'Which styles are editable?'
    const plain = firstLine + '\n\nKeep the current CSS for now.'
    const edit = 'Make the second-level heading background blue and verify the result.'
    const inspect = '截图实际看一下二级标题的样式看看有没有更好的呈现方式'
    const inspectTable = 'Inspect the first two screens of the long table.'
    const css = '.mu-container h2.mu-atx-heading ~ h2.mu-atx-heading { background: #e71765 }'
    const requests: string[] = []
    let resume: () => void = () => {}
    const inspecting = new Promise<void>(resolve => { resume = resolve })
    const failures: unknown[] = []
    const server = createServer(async(req, res) => {
      try {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const packet = JSON.parse(raw)
        const messages = packet.input ?? packet.messages
        const question = messages.findLast((item: { role?: string; content?: unknown }) => item.role === 'user' && typeof item.content === 'string').content
        requests.push(question)
        expect(packet.stream).toBe(true)
        expect(req.url).toBe(responses ? '/v1/responses' : '/v1/chat/completions')
        expect(packet.tools.map((tool: { name?: string; function?: { name: string } }) => (tool.function ?? tool).name))
          .toEqual(['capture_preview', 'edit_theme_css', 'edit_sample_markdown'])
        expect(packet.tool_choice).toBe('auto')
        const outputs = messages.filter((item: { type?: string; role?: string }) => responses ? item.type === 'function_call_output' : item.role === 'tool')
        const step = outputs.length
        const last = outputs.at(-1)
        if (!step) expect(raw).not.toContain('data:image/')
        if (step) {
          expect(last.call_id ?? last.tool_call_id).toBe('call-' + step)
          if (responses) expect(messages.some((item: { type?: string; encrypted_content?: string }) => item.type === 'reasoning' && item.encrypted_content === 'reasoning-token')).toBe(true)
        }
        if (last && (Array.isArray(last.output) || messages.at(-1).role === 'user')) {
          const uri = responses ? last.output.find((part: { type: string }) => part.type === 'input_image').image_url
            : messages.at(-1).content.find((part: { type: string }) => part.type === 'image_url').image_url.url
          expect(uri).toMatch(/^data:image\/jpeg;base64,/)
          captures.push(uri)
          sizes.push(await app.evaluate(({ nativeImage }, url) => {
            const image = nativeImage.createFromDataURL(url)
            const bitmap = image.toBitmap()
            let red = 0, blue = 0, outside = 0
            for (let i = 0; i < bitmap.length; i += 4) {
              const [b, g, r] = [bitmap[i], bitmap[i + 1], bitmap[i + 2]]
              if (Math.abs(r - 231) < 8 && Math.abs(g - 23) < 8 && Math.abs(b - 101) < 8) red++
              if (Math.abs(r - 31) < 8 && Math.abs(g - 111) < 8 && Math.abs(b - 235) < 8) blue++
              if (Math.abs(r - 240) < 8 && g < 8 && Math.abs(b - 240) < 8) outside++
            }
            return { ...image.getSize(), red, blue, outside }
          }, uri))
          if (captures.length === 1) await inspecting
        }
        let name = ''
        let args: object = {}
        let reply = 'Headings and paragraph spacing are editable.'
        if (question === edit) {
          if (step === 0 || step === 2) {
            name = 'edit_theme_css'
            args = step === 0 ? { find: '', replace: css } : { find: '#e71765', replace: '#1f6feb' }
          } else if (step === 1 || step === 3) {
            name = 'capture_preview'
            args = { framing: step === 1 ? 'node' : 'viewport', selector: 'h2', occurrence: 2, slice: 1 }
          } else reply = 'Verified the blue heading.'
        } else if (question === inspect) {
          if (step <= 1) {
            if (step) expect(last.output ?? last.content).toContain('No rendered element')
            name = 'capture_preview'
            args = { framing: 'node', selector: step ? 'h2' : '.missing-heading', occurrence: 1, slice: 1 }
          } else reply = 'The heading is visually heavier than the body text.'
        } else if (question === inspectTable) {
          if (step > 0) {
            const info = responses ? last.output[0].text : last.content
            expect(info).toMatch(new RegExp('Slice ' + step + ' of ([2-9]|[1-9][0-9]+)'))
          }
          if (step < 2) {
            name = 'capture_preview'
            args = { framing: 'node', selector: 'table', occurrence: 1, slice: step + 1 }
          } else reply = 'Inspected both table slices.'
        }
        const fn = { name, arguments: JSON.stringify(args) }
        const id = 'call-' + (step + 1)
        const output = name
          ? [{ type: 'reasoning', id: 'rs-' + id, encrypted_content: 'reasoning-token', summary: [] },
            { type: 'function_call', call_id: id, ...fn }]
          : [{ type: 'message', content: [{ type: 'output_text', text: reply }] }]
        const message = name ? { role: 'assistant', content: null, tool_calls: [{ type: 'function', id, function: fn }] }
          : { role: 'assistant', content: reply }
        if (question === inspectTable) {
          res.setHeader('Content-Type', 'text/event-stream')
          const event = (value: object) => res.write('data: ' + JSON.stringify(value) + '\n\n')
          if (responses) {
            output.forEach((item, index) => event({ type: 'response.output_item.done', output_index: index, item }))
            event({ type: 'response.completed', response: { status: 'completed' } })
          } else if (name) {
            event({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: fn.arguments.slice(0, 5) } }] } }] })
            event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fn.arguments.slice(5) } }] }, finish_reason: 'tool_calls' }] })
          } else event({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] })
          res.end('data: [DONE]\n\n')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(responses ? { status: 'completed', output } : { choices: [{ message }] }))
      } catch (error) { failures.push(error); res.writeHead(500).end() }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const profile = { id: 'vision', model: 'test', encryptedKey: '', requestType,
      baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1', inputTypes: ['image'],
      contextSize: null, outputSize: null, reasoningEffort: '' }
    const { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light', followSystemTheme: false },
      userDataFiles: { 'theme-model.json': JSON.stringify([profile, { ...profile, id: 'text', inputTypes: [] }]) } })
    try {
      const opened = app.waitForEvent('window')
      await clickMenuById(app, 'createThemeFromCurrent')
      const studio = await opened
      const table = '| Row | Value |\n| --- | --- |\n' + Array.from({ length: 75 }, (_, i) => `| ${i} | Row ${i} |`).join('\n')
      const md = '## First heading\n\n' + 'A paragraph with body text.\n\n'.repeat(70) + '## Lower heading\n\n' + 'More context.\n\n'.repeat(8) + table
      await studio.locator('.theme-studio').waitFor()
      await studio.evaluate(markdown => {
        const draftKey = sessionStorage.getItem('autumnmark.theme-studio.active-draft')
        if (!draftKey) throw new Error('Missing active theme draft')
        localStorage.setItem(draftKey + '.sample', markdown)
      }, md)
      await studio.reload()
      await studio.addStyleTag({ content: '.theme-studio :is(header, footer, .tools, .bar) { background: rgb(240 0 240) }' })
      if (responses) await (await app.browserWindow(studio)).evaluate(win => win.webContents.setZoomFactor(1.25))
      const lower = studio.frameLocator('iframe').locator('h2').nth(1)
      await expect(lower).toContainText('Lower heading')
      const top = () => lower.evaluate(node => node.getBoundingClientRect().top)
      const originalTop = await top()
      expect(originalTop).toBeGreaterThan(1000)
      const model = studio.getByRole('combobox', { name: 'Model', exact: true })
      await model.selectOption('text')
      await expect(studio.locator('.privacy')).not.toContainText('selected element')
      await model.selectOption('vision')
      await expect(studio.getByRole('checkbox', { name: /screenshot/i })).toHaveCount(0)
      await expect(studio.locator('.privacy')).toContainText('selected element')
      const prompt = studio.getByLabel('Message the theme assistant')
      const send = async(question: string) => {
        await prompt.fill(question)
        await studio.getByRole('button', { name: 'Send', exact: true }).click()
      }
      const log = studio.getByRole('log')
      await prompt.fill(firstLine + '\nKeep the current CSS for now.')
      await prompt.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(4, 4))
      await prompt.press('Shift+Enter')
      await expect(prompt).toHaveValue(plain)
      expect(await prompt.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(firstLine.length + 1)
      await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
      expect(requests).toHaveLength(0)
      await prompt.press('Enter')
      await expect(log).toContainText('Headings and paragraph spacing are editable.')
      await expect(studio.getByRole('button', { name: 'Undo last change' })).toBeDisabled()
      const user = await log.locator('.user').boundingBox()
      const assistant = await log.locator('.assistant').boundingBox()
      if (!user || !assistant) throw new Error('Missing conversation')
      expect(user.x + user.width).toBeGreaterThan(assistant.x + assistant.width)
      expect(requests).toEqual([plain])
      await expect(log.locator('.capture')).toHaveCount(0)
      await send(edit)
      const first = log.getByRole('button', { name: 'Preview screenshot 1', exact: true }).first()
      await first.click()
      const viewer = studio.getByRole('dialog', { name: 'Preview screenshot 1', exact: true })
      await expect(viewer).toBeVisible()
      await expect.poll(() => captures.length).toBe(1)
      await expect(viewer.locator('img')).toHaveAttribute('src', captures[0])
      await viewer.getByRole('button', { name: 'Zoom in' }).click()
      resume()
      await expect(lower).toHaveCSS('background-color', 'rgb(31, 111, 235)')
      await studio.keyboard.press('Escape')
      await expect(log).toContainText('Verified the blue heading.')
      expect(sizes).toHaveLength(2)
      expect(sizes[0].red).toBeGreaterThan(500)
      expect(sizes[0].height).toBeLessThan(sizes[1].height / 3)
      expect(sizes[1].blue).toBeGreaterThan(500)
      const frame = await studio.locator('iframe').boundingBox()
      if (!frame) throw new Error('Missing preview')
      expect(sizes[1].width / sizes[1].height).toBeCloseTo(frame.width / frame.height, 1)
      expect(sizes.every(size => size.outside === 0)).toBe(true)
      await expect.poll(top).toBeCloseTo(originalTop, 0)
      await studio.getByRole('button', { name: 'Undo last change' }).click()
      await expect(lower).not.toHaveCSS('background-color', 'rgb(31, 111, 235)')
      await send(inspect)
      await expect(log).toContainText('The heading is visually heavier')
      await expect(log.locator('.assistant').last().locator('.capture')).toHaveCount(1)
      expect(captures).toHaveLength(3)
      await send(inspectTable)
      await expect(log).toContainText('Inspected both table slices.')
      expect(captures).toHaveLength(5)
      expect(captures[3]).not.toBe(captures[4])
      await expect.poll(top).toBeCloseTo(originalTop, 0)
      await studio.reload()
      await expect(log).toContainText('Verified the blue heading.')
      expect(await log.locator('.capture img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(captures)
      expect(failures).toEqual([])
    } finally {
      resume()
      server.closeAllConnections()
      server.close()
      await app.close()
    }
  })
}
