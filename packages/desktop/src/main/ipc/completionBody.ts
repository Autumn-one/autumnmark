import type { ThemeReplyTrace } from '@shared/localTheme'

const maxEnvelopeLength = 8 * 1024 * 1024

/** Yields SSE data records or one complete JSON envelope from a non-streaming provider. */
export async function* completionBody(response: Response, stream: boolean, trace: ThemeReplyTrace): AsyncGenerator<string> {
  if (!response.body) throw new Error('emptyReply')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        pending += decoder.decode()
        if (!stream) yield pending
        else if (pending.startsWith('data:')) yield pending.slice(5).trim()
        return
      }
      trace.wireBytes += value.byteLength
      pending += decoder.decode(value, { stream: true })
      if (stream) {
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.length > maxEnvelopeLength) throw new Error('replyTooLarge')
          if (line.startsWith('data:')) yield line.slice(5).trim()
        }
      }
      if (pending.length > maxEnvelopeLength) throw new Error('replyTooLarge')
    }
  } finally { await reader.cancel().catch(() => {}) }
}
