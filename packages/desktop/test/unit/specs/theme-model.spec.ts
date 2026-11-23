import { describe, expect, it, vi } from 'vitest'
import { generateTheme } from '../../../src/main/ipc/themeModel'
import { runThemeTools } from '../../../src/main/ipc/themeTools'
import { modelBaseUrl, type ChatSettings } from '../../../src/main/ipc/openAi'
import { editThemeCss, themeCssIssue } from '@shared/themeCss'
import type { ThemeModelEvent, ThemeModelRequest } from '@shared/localTheme'

const request: ThemeModelRequest = { id: 'example', profileId: 'profile', base: 'light', css: 'h2 { color: red; }', baseCss: ':root { --editorColor: black; }',
  messages: [{ role: 'user', content: 'Restore the heading color' }] }

const classic: ChatSettings = { baseUrl: 'http://localhost/v1', key: '', model: 'test', requestType: 'chat-completions',
  reasoningEffort: '', contextSize: null, outputSize: null }

const readReply = async(reply: string, changes: ThemeModelEvent[]) => {
  const response = new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }),
    { headers: { 'content-type': 'application/json' } })
  return generateTheme(classic,
    request, new AbortController().signal, item => changes.push(item), async() => response)
}

describe('theme function calls', () => {
  const input = { ...request, previewTools: { baseUrl: classic.baseUrl } }
  const vision: ChatSettings = { ...classic, inputTypes: ['image'] }
  const trace = () => ({ wireBytes: 0, replyBytes: 0, assistantText: '' })
  const call = (id: string, name: string, args: object) => ({ type: 'function', id, function: { name, arguments: JSON.stringify(args) } })
  const reply = (message: object) => Response.json({ choices: [{ message: { role: 'assistant', ...message } }] })

  it('can finish an edit without requesting any screenshot', async() => {
    const capture = vi.fn()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ tool_calls: [call('edit', 'edit_theme_css', { find: 'red', replace: 'teal' })] }))
      .mockResolvedValueOnce(reply({ content: 'Applied.' }))
    const changes: ThemeModelEvent[] = []
    const css = await runThemeTools(vision, input, new AbortController().signal, event => changes.push(event), capture, trace(), fetcher)
    expect(css).toBe('h2 { color: teal; }')
    expect(changes).toEqual([{ css }, { message: 'Applied.' }])
    expect(capture).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('replaces the example Markdown with a tool call and renders no screenshot', async() => {
    const sampleMarkdown = '# Theme gallery\n\n> A sample quotation'
    const changes: ThemeModelEvent[] = []
    const capture = vi.fn()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ tool_calls: [call('sample', 'edit_sample_markdown', { markdown: sampleMarkdown })] }))
      .mockResolvedValueOnce(reply({ content: 'Example updated.' }))
    const css = await runThemeTools(vision, { ...input, sampleMarkdown: '# Original' }, new AbortController().signal,
      event => changes.push(event), capture, trace(), fetcher)
    expect(css).toBe(input.css)
    expect(changes).toEqual([{ sampleMarkdown }, { message: 'Example updated.' }])
    expect(capture).not.toHaveBeenCalled()
  })

  it('rejects disabled image input or a changed destination before asking the provider', async() => {
    const fetcher = vi.fn<typeof fetch>()
    for (const settings of [classic, { ...vision, baseUrl: 'https://changed.test' }]) {
      await expect(runThemeTools(settings, input, new AbortController().signal, vi.fn(), vi.fn(), trace(), fetcher))
        .rejects.toThrow('modelChanged')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps multiple call IDs paired before supplying Chat Completions with image input', async() => {
    const shot = { framing: 'viewport', selector: '', occurrence: 1, slice: 1 }
    const capture = vi.fn().mockResolvedValue({ text: 'Captured', image: 'data:image/jpeg;base64,AQ==' })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ tool_calls: [call('bad', 'capture_preview', { ...shot, slice: 0 }), call('ok', 'capture_preview', shot)] }))
      .mockImplementationOnce(async(_url, init) => {
        const { messages } = JSON.parse(String(init?.body))
        expect(messages.slice(-3).map((item: { role: string }) => item.role)).toEqual(['tool', 'tool', 'user'])
        expect(messages.at(-3)).toMatchObject({ tool_call_id: 'bad', content: expect.stringContaining('Expected') })
        expect(messages.at(-2)).toMatchObject({ tool_call_id: 'ok', content: 'Captured' })
        expect(messages.at(-1).content[1].image_url.url).toBe('data:image/jpeg;base64,AQ==')
        return reply({ content: 'Reviewed.' })
      })
    await runThemeTools(vision, input, new AbortController().signal, vi.fn(), capture, trace(), fetcher)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(shot, request.css)
  })
})

describe('theme model contract', () => {
  it('accepts a local base URL or an explicit HTTPS endpoint', () => {
    expect(modelBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
    expect(modelBaseUrl('https://provider.test/api/chat/completions')).toBe('https://provider.test/api')
    expect(modelBaseUrl('https://provider.test/api/responses/')).toBe('https://provider.test/api')
    expect(() => modelBaseUrl('http://provider.test/v1')).toThrow('invalidEndpoint')
    expect(() => modelBaseUrl('https://user:pass@provider.test/v1')).toThrow('invalidEndpoint')
  })
  it('reserves the output budget, retaining the current CSS and latest instruction', async() => {
    const settings = { ...classic, reasoningEffort: 'high', contextSize: 1000, outputSize: 200 }
    const messages: ThemeModelRequest['messages'] = [{ role: 'user', content: 'a'.repeat(4000) }, ...request.messages]
    const fetcher: typeof fetch = async(_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.messages).toHaveLength(3)
      expect(body.messages[2]).toEqual(request.messages[0])
      expect(body).toMatchObject({ reasoning_effort: 'high', max_completion_tokens: 200 })
      return Response.json({ choices: [{ message: { content: '{"message":"ok"}' } }] })
    }
    await generateTheme(settings, { ...request, messages }, new AbortController().signal, () => {}, fetcher)
    await expect(generateTheme({ ...settings, contextSize: 201 }, request, new AbortController().signal, () => {}, fetcher))
      .rejects.toThrow('contextTooSmall')
  })
  it('accepts validated CSS edits and summaries from a non-streaming provider', async() => {
    const changes: ThemeModelEvent[] = []
    await readReply('{"find":"color: red","replace":"margin-top: 2em"}\n{"message":"Restored."}', changes)
    expect(changes).toEqual([{ css: 'h2 { margin-top: 2em; }' }, { message: 'Restored.' }])
  })
  it('passes the current example to text models and applies a Markdown replacement', async() => {
    const sampleMarkdown = '# Example\n\n```json\n{"size": 2}\n```'
    const changes: ThemeModelEvent[] = []
    const fetcher: typeof fetch = async(_url, init) => {
      const { messages } = JSON.parse(String(init?.body))
      expect(JSON.parse(messages[1].content)).toMatchObject({ sampleMarkdown: '# Original' })
      const content = JSON.stringify({ sampleMarkdown }) + '\n' + JSON.stringify({ message: 'Example updated.' })
      return Response.json({ choices: [{ message: { content } }] })
    }
    const css = await generateTheme(classic, { ...request, sampleMarkdown: '# Original' },
      new AbortController().signal, event => changes.push(event), fetcher)
    expect(css).toBe(request.css)
    expect(changes).toEqual([{ sampleMarkdown }, { message: 'Example updated.' }])
  })

  it('can answer a theme question when a large example exceeds the configured context', async() => {
    const fetcher: typeof fetch = async(_url, init) => {
      const { messages } = JSON.parse(String(init?.body))
      const context = JSON.parse(messages[1].content)
      expect(context).toMatchObject({ css: request.css, sampleMarkdownOmitted: true })
      expect(context).not.toHaveProperty('sampleMarkdown')
      return Response.json({ choices: [{ message: { content: 'The heading is red.' } }] })
    }
    await generateTheme({ ...classic, contextSize: 1500 }, { ...request, sampleMarkdown: 'Example text\n'.repeat(1000) },
      new AbortController().signal, vi.fn(), fetcher)
  })

  it('keeps a clarification and quoted edit examples in the conversation', async() => {
    const changes: ThemeModelEvent[] = []
    const reply = '你更想要柔和的阴影，还是更清晰的边框？\n\n示例：\n```json\n{"find":"","replace":"h2 {color: green}"}\n```'
    const css = await readReply(reply, changes)
    expect(css).toBe(request.css)
    expect(changes).toEqual([{ message: reply }])
  })
  it('accepts a pretty-printed edit followed by a natural-language explanation', async() => {
    const changes: ThemeModelEvent[] = []
    const edit = JSON.stringify({ find: 'color: red', replace: 'color: teal' }, null, 2)
    await readReply(edit + '\nThe heading now uses teal.', changes)
    expect(changes).toEqual([{ css: 'h2 { color: teal; }' }, { message: 'The heading now uses teal.' }])
  })
  it('distinguishes an empty response from an invalid CSS edit', async() => {
    await expect(readReply('  \n', [])).rejects.toThrow('emptyReply')
  })
  it.each(['adjacent', 'array', 'envelope'])('reads %s edit records with braces inside CSS strings', async(format) => {
    const entries = [{ find: '', replace: '.note::after { content: "}"; }' }, { message: 'Added.' }]
    const reply = format === 'adjacent' ? entries.map(item => JSON.stringify(item)).join('')
      : format === 'array' ? '```json\n' + JSON.stringify(entries, null, 2) + '\n```'
        : JSON.stringify({ edits: entries.slice(0, 1), message: 'Added.' }, null, 2)
    const changes: ThemeModelEvent[] = []
    const css = await readReply(reply, changes)
    expect(css).toContain('.note::after { content: "}"; }')
    expect(changes).toEqual([{ css }, { message: 'Added.' }])
  })
  it.each(['chat-completions', 'responses'] as const)('counts assistant text separately from %s stream framing', async(requestType) => {
    const noise = requestType === 'responses'
      ? { type: 'response.reasoning_summary_text.delta', delta: 'private reasoning' }
      : { choices: [{ delta: { reasoning_content: 'private reasoning' } }] }
    const reply = 'Got it.'
    const event = requestType === 'responses' ? { type: 'response.output_text.delta', delta: reply }
      : { choices: [{ delta: { content: reply } }] }
    const sse = (packet: unknown) => 'data: ' + JSON.stringify(packet) + '\n\n'
    const wire = sse(noise).repeat(10000) + sse(event) +
      (requestType === 'responses' ? sse({ type: 'response.completed' }) : 'data: [DONE]\n\n')
    const trace = { wireBytes: 0, replyBytes: 0, assistantText: '' }
    const changes: ThemeModelEvent[] = []
    await generateTheme({ ...classic, requestType }, request, new AbortController().signal, change => changes.push(change),
      async() => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), trace)
    expect(trace.wireBytes).toBeGreaterThan(512 * 1024)
    expect(trace).toMatchObject({ replyBytes: reply.length, assistantText: reply })
    expect(changes).toEqual([{ message: reply }])
  })
  it('retains the reply that failed to match the original CSS for offline diagnosis', async() => {
    const reply = '{"find":"body { color: teal; }","replace":"body { color: red; }"}'
    const trace = { wireBytes: 0, replyBytes: 0, assistantText: '' }
    await expect(generateTheme(classic, request, new AbortController().signal, () => {},
      async() => Response.json({ choices: [{ message: { content: reply } }] }), trace))
      .rejects.toThrow('invalidReply:missingMatch')
    expect(trace.assistantText).toBe(reply)
  })
  it.each(['chat-completions', 'responses'] as const)('keeps truncated %s output in the diagnostic', async(requestType) => {
    const partial = '{"find":"color: red","replace":"color:'
    const payload = requestType === 'responses'
      ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: partial }] }] }
      : { choices: [{ finish_reason: 'length', message: { content: partial } }] }
    const trace = { wireBytes: 0, replyBytes: 0, assistantText: '' }
    await expect(generateTheme({ ...classic, requestType }, request, new AbortController().signal, () => {},
      async() => Response.json(payload), trace)).rejects.toThrow('invalidReply:truncated')
    expect(trace.assistantText).toBe(partial)
  })
  it.each(['chat-completions', 'responses'] as const)('accepts streamed prose from %s without a CSS edit', async(requestType) => {
    const chunks = ['先确认一下：', '你更喜欢哪种边框？\n', '\n可以保持', '当前主题。']
    const packets = chunks.map(delta => requestType === 'responses'
      ? { type: 'response.output_text.delta', delta }
      : { choices: [{ delta: { content: delta } }] })
    const end = requestType === 'responses' ? '{"type":"response.completed"}' : '[DONE]'
    const data = [...packets.map(packet => JSON.stringify(packet)), end].map(value => 'data: ' + value + '\n\n').join('')
    const changes: ThemeModelEvent[] = []
    const css = await generateTheme({ ...classic, requestType }, request, new AbortController().signal,
      change => changes.push(change), async() => new Response(data, { headers: { 'content-type': 'text/event-stream' } }))
    expect(css).toBe(request.css)
    expect(changes).toEqual([{ message: chunks.join('') }])
  })
  it.each([true, false])('reads Responses API theme edits with streaming = %s', async(streaming) => {
    const edit = '{"find":"color: red","replace":"margin: 1em"}\n'
    const summary = '{"message":"Updated."}'
    const response = { status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: edit + summary }] }
    ] }
    const fetcher: typeof fetch = async(url, init) => {
      expect(url).toBe('http://localhost/v1/responses')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ stream: true, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2048 })
      expect(body.input.at(-1)).toEqual(request.messages[0])
      if (!streaming) return Response.json(response)
      const events = [
        { type: 'response.reasoning_summary_text.delta', delta: 'ignored' },
        { type: 'response.output_text.delta', delta: edit + summary.slice(0, 4) },
        { type: 'response.output_text.delta', delta: summary.slice(4) },
        { type: 'response.completed', response }
      ]
      return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
        { headers: { 'content-type': 'text/event-stream' } })
    }
    const changes: ThemeModelEvent[] = []
    await generateTheme({ ...classic, requestType: 'responses', reasoningEffort: 'low', outputSize: 2048 },
      request, new AbortController().signal, change => changes.push(change), fetcher)
    expect(changes).toEqual([{ css: 'h2 { margin: 1em; }' }, { message: 'Updated.' }])
  })
  it.each(['{"find":"missing","replace":"padding: 20px"}', '{"find":"","replace":"h2 {"}',
    '{"find":"","replace":"@import url(example.css);"}', '{unfinished'])(
    'keeps an unsupported record out of the preview', async(reply) => {
      const changes: ThemeModelEvent[] = []
      await expect(readReply(reply, changes)).rejects.toThrow('invalidReply')
      expect(changes).toEqual([])
    })
  it('preserves other rules and rejects an ambiguous edit', () => {
    const css = 'h2 { margin: 2em }\np { margin: 2em }'
    expect(() => editThemeCss(css, 'margin: 2em', 'margin: 1em')).toThrow('invalidReply')
    expect(editThemeCss(css, 'p { margin: 2em }', '')).toBe('h2 { margin: 2em }\n')
  })
  it('accepts local layout CSS and filters resource-loading rules', () => {
    expect(themeCssIssue('@media (min-width: 500px) { .mu-container { display: grid; gap: 1em } }')).toBe('')
    for (const css of ['@import "a.css";', '.a { background: url(a.png) }', '.a { background: image-set("a.png" 1x) }']) {
      expect(themeCssIssue(css)).not.toBe('')
    }
  })
})
