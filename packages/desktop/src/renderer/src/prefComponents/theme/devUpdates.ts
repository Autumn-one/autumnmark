// The preview iframe has its own Vite client. Both clients must wait until the chat's final IndexedDB write commits.
export function deferThemeDevUpdates(hot: NonNullable<ImportMeta['hot']>, whenIdle?: () => Promise<void> | undefined): () => void {
  const studio = window.parent as Window & { waitForThemeChat?: () => Promise<void> | undefined }
  if (whenIdle) studio.waitForThemeChat = whenIdle
  const wait = () => studio.waitForThemeChat?.()
  hot.on('vite:beforeFullReload', wait)
  hot.on('vite:beforeUpdate', wait)
  return () => {
    hot.off('vite:beforeFullReload', wait)
    hot.off('vite:beforeUpdate', wait)
    if (whenIdle && studio.waitForThemeChat === whenIdle) delete studio.waitForThemeChat
  }
}
