// Older main processes surfaced intentional cancellation as a rejected Electron invoke.
export const isCancelledRequest = (cause: unknown): boolean =>
  /(?:^|Error invoking remote method 'mt::theme::generate(?:-with-tools)?': )(?:DOMException \[AbortError\]|AbortError): (?:This operation was aborted|The operation was aborted)\.?$/.test(
    cause instanceof Error ? cause.message : String(cause))

export const modelError = (cause: unknown, t: (key: string) => string): string => {
  const message = String(cause)
  if (message.includes('No handler registered') && message.includes('mt::theme::generate-with-tools')) return t('ai.restartTools')
  if (message.includes('replyTooLarge')) return t('studio.replyError.tooLarge')
  const detail = /invalidReply:(missingMatch|ambiguousMatch|css|format|incomplete|truncated)(.*)/.exec(message)
  if (detail) return t('studio.replyError.' + detail[1]) + (detail[1] === 'css' ? detail[2] : '')
  const status = message.match(/HTTP (\d{3})/)
  if (status) return t('studio.httpError') + ' ' + status[1]
  const aiCode = ['invalidSize', 'contextTooSmall', 'unexpectedTestReply', 'invalidModelList', 'modelChanged', 'previewFailed', 'reviewLimit']
    .find(item => message.includes(item))
  if (aiCode) return t('ai.' + aiCode)
  const known = ['invalidEndpoint', 'invalidRequest', 'newKeyRequired', 'keyStore', 'invalidReply', 'emptyReply', 'configureFirst']
  const code = known.find(item => message.includes(item))
  return t('studio.' + (code ?? 'requestFailed'))
}
