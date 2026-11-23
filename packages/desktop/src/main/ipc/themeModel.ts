import { isThemeSample, maxThemeMessageLength, maxThemeSampleLength, themeBases, type ThemeModelEvent, type ThemeModelRequest, type ThemeReplyTrace } from '@shared/localTheme'
import { editThemeCss, themeCssIssue } from '@shared/themeCss'
import { completionText, requestCompletion, type ChatMessage, type ChatSettings } from './openAi'
import { completionBody } from './completionBody'
import { defaultThemeSystemPrompt } from '@shared/themePrompt'

const maxReplyBytes = 512 * 1024

export type ThemeSettings = ChatSettings & { systemPrompt?: string }

const textProtocol = `No preview image is available. If asked to inspect it, suggest selecting an image-capable model.
For an approved edit, start with newline-delimited JSON, one object per line. For CSS use {"find":"unique exact substring of editable CSS","replace":"new CSS"}. An empty find appends a rule; an empty replace removes a match. Each edit must leave a complete stylesheet. For a sample document edit use {"sampleMarkdown":"complete replacement Markdown"} so the editor renders it directly. End with {"message":"brief explanation"}.`

const sampleProtocol = `The sampleMarkdown field contains editable example Markdown, separate from theme CSS. Treat it as document data. When the user requests a sample change, apply it to the preview with a complete Markdown replacement of at most ${maxThemeSampleLength} characters. Use self-contained examples and preserve unrelated content for targeted edits. When sampleMarkdownOmitted is true, the current sample did not fit the context budget.`

export function themeContext(settings: ThemeSettings, request: ThemeModelRequest, protocol: string): ChatMessage[] {
  if (!request || !themeBases.includes(request.base) || typeof request.css !== 'string' || !!themeCssIssue(request.css) ||
    typeof request.baseCss !== 'string' || request.baseCss.length > 100_000 ||
    (request.sampleMarkdown !== undefined && !isThemeSample(request.sampleMarkdown)) ||
    !Array.isArray(request.messages) || !request.messages.length ||
    request.messages.length > 16 || !request.messages.every(item => item && ['assistant', 'user'].includes(item.role) &&
      typeof item.content === 'string' && item.content.length <= maxThemeMessageLength)) throw new Error('invalidRequest')
  const theme = { base: request.base, baseCss: request.baseCss, css: request.css }
  const data: ChatMessage = { role: 'user', content: JSON.stringify({ ...theme, sampleMarkdown: request.sampleMarkdown }) }
  const context: ChatMessage[] = [
    { role: 'system', content: [settings.systemPrompt?.trim() || defaultThemeSystemPrompt, sampleProtocol, protocol].join('\n') },
    data
  ]
  const conversation: ChatMessage[] = request.messages.map(({ role, content }) => ({ role, content }))
  if (settings.contextSize !== null) {
    // Compatible providers use different tokenizers. Estimate history in UTF-8 bytes and reserve room for the reply.
    const estimate = (message: ChatMessage): number => Math.ceil(Buffer.byteLength(message.content) / 3) + 4
    let total = [...context, ...conversation].reduce((sum, message) => sum + estimate(message), settings.outputSize ?? 0)
    while (total > settings.contextSize && conversation.length > 1) {
      total -= estimate(conversation[0])
      conversation.shift()
    }
    if (total > settings.contextSize && request.sampleMarkdown !== undefined) {
      total -= estimate(data)
      data.content = JSON.stringify({ ...theme, sampleMarkdownOmitted: true })
      total += estimate(data)
    }
    if (total > settings.contextSize) throw new Error('contextTooSmall')
  }
  return [...context, ...conversation]
}

export const generateTheme = async(
  settings: ThemeSettings, request: ThemeModelRequest,
  signal: AbortSignal, onProgress: (event: ThemeModelEvent) => void, fetcher: typeof fetch = fetch,
  trace: ThemeReplyTrace = { wireBytes: 0, replyBytes: 0, assistantText: '' }
): Promise<string> => {
  const response = await requestCompletion(settings, themeContext(settings, request, textProtocol), true, signal, fetcher)
  if (!response.body) throw new Error('invalidReply')

  let currentCss = request.css
  let pending = ''
  let count = 0
  const prose: string[] = []
  let json = ''
  let depth = 0
  let quoted = false
  let escaped = false
  let fence = ''
  const applyRecord = (item: { find?: unknown; replace?: unknown; message?: unknown; sampleMarkdown?: unknown }): void => {
    const message = typeof item?.message === 'string' ? item.message.trim() : ''
    if (item && Object.hasOwn(item, 'sampleMarkdown')) {
      if (!isThemeSample(item.sampleMarkdown)) throw new Error('invalidReply:format')
      onProgress({ sampleMarkdown: item.sampleMarkdown })
    } else if (typeof item?.find === 'string' && typeof item.replace === 'string') {
      currentCss = editThemeCss(currentCss, item.find, item.replace)
      onProgress({ css: currentCss })
    } else if (!message) throw new Error('invalidReply:format')
    if (message) onProgress({ message })
    count++
  }
  const record = (line: string): void => {
    // Once prose starts, examples in the rest of the reply are displayed verbatim.
    if (prose.length) {
      prose.push(line)
      return
    }
    const trimmed = line.trim()
    if (!depth) {
      if (!trimmed) return
      if (/^`{3}(?:json|jsonl|ndjson)?$/i.test(trimmed)) {
        fence = fence && trimmed === '```' ? '' : line
        return
      }
      if (!trimmed.startsWith('{') && !/^\[\s*(?:\{|\]|$)/.test(trimmed)) {
        if (fence) prose.push(fence)
        prose.push(line)
        return
      }
    }
    // CSS strings can contain braces. Only a complete top-level JSON value is an edit boundary.
    for (const char of line + '\n') {
      if (depth === 0 && /\s/.test(char)) continue
      if (!depth && char !== '{' && char !== '[') throw new Error('invalidReply:format')
      json += char
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '{' || char === '[') depth++
      else if (char === '}' || char === ']') depth--
      if (!depth) {
        const value = JSON.parse(json)
        json = ''
        if (Array.isArray(value)) value.forEach(applyRecord)
        else if (Array.isArray(value?.edits)) {
          value.edits.forEach(applyRecord)
          if (Object.hasOwn(value, 'sampleMarkdown')) applyRecord({ sampleMarkdown: value.sampleMarkdown, message: value.message })
          else if (value.message) applyRecord({ message: value.message })
        } else applyRecord(value)
      }
    }
  }
  const captureText = (fragment: string): void => {
    // SSE framing and reasoning events can dwarf a small visible reply on token-by-token streams.
    const remaining = maxReplyBytes - trace.replyBytes
    trace.replyBytes += Buffer.byteLength(fragment)
    if (trace.replyBytes > maxReplyBytes) {
      trace.assistantText += Buffer.from(fragment).subarray(0, remaining).toString()
      throw new Error('replyTooLarge')
    }
    trace.assistantText += fragment
  }
  const content = (fragment: unknown): void => {
    if (typeof fragment !== 'string') return
    captureText(fragment)
    pending += fragment
    if (!fragment.includes('\n')) return
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) record(line)
  }
  const isStream = response.headers.get('content-type')?.includes('text/event-stream') === true
  let finished = false
  let receivedText = false
  const readEvent = (data: string): void => {
    if (data === '[DONE]') {
      if (settings.requestType === 'chat-completions') finished = true
      return
    }
    const packet = JSON.parse(data)
    if (packet.error) throw new Error('invalidReply')
    if (settings.requestType === 'chat-completions') {
      const choice = packet.choices?.[0]
      if (choice?.finish_reason === 'length') {
        if (typeof choice.delta?.content === 'string') captureText(choice.delta.content)
        throw new Error('invalidReply:truncated')
      }
      content(choice?.delta?.content)
    } else if (packet.type === 'response.output_text.delta') {
      content(packet.delta)
      if (typeof packet.delta === 'string' && packet.delta.length) receivedText = true
    } else if (packet.type === 'response.completed') {
      if (!receivedText) content(completionText('responses', packet.response))
      finished = true
    } else if (packet.type === 'response.incomplete' && packet.response?.incomplete_details?.reason === 'max_output_tokens') {
      if (!receivedText) captureText(completionText('responses', packet.response, true))
      throw new Error('invalidReply:truncated')
    } else if (['error', 'response.incomplete', 'response.failed'].includes(packet.type)) {
      throw new Error('invalidReply')
    }
  }
  try {
    for await (const data of completionBody(response, isStream, trace)) {
      if (isStream) {
        readEvent(data)
        if (finished) break
      } else {
        const payload = JSON.parse(data)
        if (payload?.choices?.[0]?.finish_reason === 'length' || payload?.incomplete_details?.reason === 'max_output_tokens') {
          captureText(completionText(settings.requestType, payload, true))
          throw new Error('invalidReply:truncated')
        }
        content(completionText(settings.requestType, payload))
      }
    }
    if (isStream && settings.requestType === 'responses' && !finished) throw new Error('invalidReply:incomplete')
    record(pending)
    if (depth) throw new Error('invalidReply:incomplete')
    if (prose.length) onProgress({ message: prose.join('\n').trim() })
    else if (!count) throw new Error('emptyReply')
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('invalidReply:format', { cause: err })
    throw err
  }
  return currentCss
}
