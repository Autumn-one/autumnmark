import type { PreparedPreview, PreviewTarget } from '@shared/localTheme'

let releasePrevious: (() => void) | undefined
const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export async function preparePreviewTarget(target: PreviewTarget, port: MessagePort): Promise<void> {
  releasePrevious?.()
  const moved: { element: Element; x: number; y: number; lastX: number; lastY: number }[] = []
  const scroll = (element: Element, dx: number, dy: number): void => {
    if (!dx && !dy) return
    const x = element.scrollLeft
    const y = element.scrollTop
    element.scrollBy({ left: dx, top: dy, behavior: 'instant' })
    if (x !== element.scrollLeft || y !== element.scrollTop) moved.push({ element, x, y, lastX: element.scrollLeft, lastY: element.scrollTop })
  }
  const release = (): void => {
    if (releasePrevious !== release) return
    releasePrevious = undefined
    for (const { element, x, y, lastX, lastY } of moved.reverse()) {
      // A scroll gesture made by the user while Chromium captures takes precedence.
      if (element.scrollLeft === lastX && element.scrollTop === lastY) element.scrollTo({ left: x, top: y, behavior: 'instant' })
    }
    clearTimeout(timeout)
    port.close()
  }
  releasePrevious = release
  const timeout = window.setTimeout(release, 15000)
  port.onmessage = release
  let prepared: PreparedPreview
  try {
    await document.fonts.ready
    if (releasePrevious !== release) return
    let node: Element | undefined
    let slices = 1
    let sliceOffset = 0
    let sliceHeight = 0
    const ancestors: Element[] = []
    if (target.selector) {
      const matches = [...document.querySelectorAll(target.selector)].filter(element =>
        element.checkVisibility({ visibilityProperty: true }) && element.getBoundingClientRect().height > 0)
      node = matches[target.occurrence - 1]
      if (!node) throw new Error('No rendered element at that selector and occurrence.')
      let available = innerHeight
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        ancestors.push(parent)
        if (getComputedStyle(parent).overflowY !== 'visible' && parent.clientHeight > 0) available = Math.min(available, parent.clientHeight)
      }
      const box = node.getBoundingClientRect()
      const internalScroll = node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 &&
        (node === document.scrollingElement || getComputedStyle(node).overflowY !== 'visible')
      const fullHeight = internalScroll ? node.scrollHeight : box.height
      const step = Math.max(1, Math.min(available, internalScroll ? node.clientHeight : box.height))
      slices = Math.max(1, Math.ceil((fullHeight - 0.5) / step))
      if (target.slice > slices) throw new Error(`This element has ${slices} vertical slices.`)
      sliceOffset = (target.slice - 1) * step
      sliceHeight = Math.min(step, fullHeight - sliceOffset)
      if (internalScroll) {
        scroll(node, 0, sliceOffset - node.scrollTop)
        if (node !== document.scrollingElement) sliceOffset += node.clientTop - node.scrollTop
      }
      for (const parent of ancestors) {
        if (parent.scrollHeight <= parent.clientHeight && parent.scrollWidth <= parent.clientWidth) continue
        const root = parent === document.scrollingElement
        const container = parent.getBoundingClientRect()
        const top = root ? 0 : container.top + parent.clientTop
        const left = root ? 0 : container.left + parent.clientLeft
        const rect = node.getBoundingClientRect()
        const sliceTop = rect.top + sliceOffset
        const dx = rect.left < left || rect.right > left + parent.clientWidth
          ? rect.left - left - Math.max(0, (parent.clientWidth - rect.width) / 2) : 0
        const dy = sliceTop < top || sliceTop + sliceHeight > top + parent.clientHeight
          ? sliceTop - top - Math.max(0, (parent.clientHeight - sliceHeight) / 2) : 0
        scroll(parent, dx, dy)
      }
    }
    await painted()
    if (releasePrevious !== release) return
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight
    let clipped = false
    if (node && target.framing === 'node') {
      const box = node.getBoundingClientRect()
      left = Math.max(left, box.left)
      top = Math.max(top, box.top + sliceOffset)
      right = Math.min(right, box.right)
      bottom = Math.min(bottom, box.top + sliceOffset + sliceHeight)
      for (const parent of ancestors) {
        if (parent === document.scrollingElement) continue
        const style = getComputedStyle(parent)
        const rect = parent.getBoundingClientRect()
        if (style.overflowX !== 'visible') {
          left = Math.max(left, rect.left + parent.clientLeft)
          right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth)
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, rect.top + parent.clientTop)
          bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight)
        }
      }
      if (right - left < 1 || bottom - top < 1) throw new Error('The selected element is outside the rendered preview.')
      clipped = right - left < box.width - 1 || bottom - top < sliceHeight - 1
    }
    prepared = { crop: { x: left, y: top, width: right - left, height: bottom - top,
      viewportWidth: innerWidth, viewportHeight: innerHeight, clipped, slices } }
  } catch (cause) {
    prepared = { error: cause instanceof DOMException ? 'Invalid CSS selector.' : cause instanceof Error ? cause.message : 'Preview unavailable.' }
  }
  if (releasePrevious === release) port.postMessage(prepared)
}
