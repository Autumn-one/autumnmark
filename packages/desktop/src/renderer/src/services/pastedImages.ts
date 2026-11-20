import { reactive } from 'vue'
import { embedImage } from '@/util/embedImage'

interface PasteProgress {
  tabId: string
  total: number
  completed: number
  failed: number
  visible: boolean
}

export const imagePasteJobs = reactive(new Set<PasteProgress>())

function documentImageSource(src: string): string {
  if (src.startsWith('//')) return 'https:' + src
  if (/^(?:https?|file):/i.test(src)) return src
  const path = src.split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export async function embedDocumentImages(sources: string[], tab: { id: string; pathname?: string | null }) {
  const counts = new Map<string, number>()
  for (const src of sources) counts.set(src, (counts.get(src) ?? 0) + 1)
  const pending = counts.entries()
  const converted = new Map<string, string>()
  const path = tab.pathname
  const job = reactive({ tabId: tab.id, total: sources.length, completed: 0, failed: 0, visible: false })
  imagePasteJobs.add(job)
  const delay = window.setTimeout(() => { job.visible = true }, 300)
  async function worker() {
    for (const [src, count] of pending) {
      try {
        const data = await embedImage(documentImageSource(src), path)
        converted.set(src, data)
      } catch {
        job.failed += count
      } finally {
        job.completed += count
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(3, counts.size) }, worker))
    return converted
  } finally {
    window.clearTimeout(delay)
    if (job.failed) job.visible = true
    if (job.visible) window.setTimeout(() => imagePasteJobs.delete(job), job.failed ? 4500 : 650)
    else imagePasteJobs.delete(job)
  }
}
