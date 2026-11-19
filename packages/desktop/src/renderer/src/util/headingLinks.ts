export interface HeadingLinkRequest {
  file: string
  query: string
  rect: { left: number; top: number; bottom: number }
  apply(href: string, title: string): void
}

export function headingLinkFile(input: string, currentPath?: string) {
  if (!input || !currentPath) return
  let relative = input
  try {
    relative = decodeURIComponent(input)
  } catch {
    // A literal percent is legal in a filename.
  }
  if (/^(?:[a-z][\w+.-]*:|[/\\])/i.test(relative) || relative.includes('\0')) return
  if (!window.path.extname(relative)) relative += '.md'
  if (!window.fileUtils.hasMarkdownExtension(relative)) return
  const pathname = window.path.join(window.path.dirname(currentPath), relative)
  const href = relative.replace(/\\/g, '/').split('/').map(part =>
    encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')
  ).join('/')
  return { pathname, href }
}
