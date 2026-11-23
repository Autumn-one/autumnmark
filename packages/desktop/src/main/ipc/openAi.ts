import type { AiModelOptions, AiRequestType } from '@shared/aiModel'

export const modelBaseUrl = (input: string): string => {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('invalidEndpoint') }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    throw new Error('invalidEndpoint')
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses)$/, '')
  return url.href.replace(/\/+$/, '')
}

export interface ModelConnection {
  baseUrl: string
  key: string
}

export type ChatSettings = ModelConnection & AiModelOptions

const request = async(connection: ModelConnection, path: string, init: RequestInit, fetcher: typeof fetch) => {
  const response = await fetcher(connection.baseUrl + path, {
    ...init,
    redirect: 'error',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(connection.key ? { Authorization: 'Bearer ' + connection.key } : {})
    }
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('HTTP ' + response.status)
  }
  return response
}

export const listProviderModels = async(connection: ModelConnection): Promise<string[]> => {
  const response = await request(connection, '/models', { signal: AbortSignal.timeout(30000) }, fetch)
  const payload = await response.json().catch(() => null)
  if (!Array.isArray(payload?.data)) throw new Error('invalidModelList')
  const ids = new Set<string>()
  for (const item of payload.data) {
    if (typeof item?.id !== 'string' || !item.id.trim()) throw new Error('invalidModelList')
    ids.add(item.id)
  }
  return [...ids].sort()
}

export interface ChatMessage { role: 'system' | 'assistant' | 'user'; content: string }

export const requestCompletion = (settings: ChatSettings, messages: readonly unknown[], stream: boolean,
  signal: AbortSignal, fetcher: typeof fetch = fetch, tools?: readonly object[], toolChoice: 'auto' | 'none' = 'auto'): Promise<Response> => {
  const responses = settings.requestType === 'responses'
  const options = responses
    ? {
      input: messages, store: false,
      ...(tools ? { include: ['reasoning.encrypted_content'] } : {}),
      ...(settings.reasoningEffort ? { reasoning: { effort: settings.reasoningEffort } } : {}),
      ...(settings.outputSize ? { max_output_tokens: settings.outputSize } : {})
    }
    : {
      messages,
      ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
      ...(settings.outputSize ? { max_completion_tokens: settings.outputSize } : {})
    }
  return request(settings, responses ? '/responses' : '/chat/completions', {
    method: 'POST', signal, body: JSON.stringify({ model: settings.model, stream, ...options,
      ...(tools ? { tools, tool_choice: toolChoice, parallel_tool_calls: false } : {}) })
  }, fetcher)
}

interface CompletionPayload {
  status?: string
  error?: unknown
  choices?: { message?: { content?: string } }[]
  output?: { type: string; content?: { type: string; text?: string }[] }[]
}

export function completionText(type: AiRequestType, payload: CompletionPayload | null, includeIncomplete = false): string {
  if (!payload || payload.error) return ''
  if (type === 'chat-completions') return payload.choices?.[0]?.message?.content ?? ''
  if ((payload.status && payload.status !== 'completed' && !(includeIncomplete && payload.status === 'incomplete')) ||
    !Array.isArray(payload.output)) return ''
  return payload.output.flatMap(item => {
    if (item?.type !== 'message' || !Array.isArray(item.content)) return []
    return item.content.filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text)
  }).join('')
}

export const testModelConnection = async(settings: ChatSettings): Promise<void> => {
  const response = await requestCompletion(settings, [{ role: 'user', content: '仅回复1' }], false, AbortSignal.timeout(60000))
  const payload = await response.json().catch(() => null)
  const reply = completionText(settings.requestType, payload)
  if (typeof reply !== 'string' || reply.trim() !== '1') throw new Error('unexpectedTestReply')
}
