export type DrawingPreviewPriority = 'viewport' | 'export' | 'background'

const priorities: Record<DrawingPreviewPriority, number> = { viewport: 0, export: 1, background: 2 }
const PREVIEW_TIMEOUT_MS = 30_000
const WAIT_TIMEOUT_MS = 60_000

interface PreviewJob {
  priorities: Map<symbol, number>
  run: () => Promise<string>
  promise: Promise<string>
  resolve: (url: string) => void
  reject: (error: unknown) => void
}

/** A timed-out export still owns the canvas slot until the renderer actually returns. */
export class DrawingPreviewQueue {
  private jobs = new Map<unknown, PreviewJob>()
  private waiting = new Set<PreviewJob>()
  private running = false

  schedule(key: unknown, priority: DrawingPreviewPriority, run: () => Promise<string>, signal?: AbortSignal): Promise<string> {
    let job = this.jobs.get(key)
    if (!job) {
      let resolve!: PreviewJob['resolve']
      let reject!: PreviewJob['reject']
      const promise = new Promise<string>((yes, no) => {
        resolve = yes
        reject = no
      })
      job = { priorities: new Map(), run, promise, resolve, reject }
      this.jobs.set(key, job)
      this.waiting.add(job)
      const queued = job
      const deadline = setTimeout(() => {
        const waiting = this.waiting.delete(queued)
        if (waiting) queued.reject(new Error('Drawing preview timed out in queue'))
      }, WAIT_TIMEOUT_MS)
      const forget = () => {
        clearTimeout(deadline)
        if (this.jobs.get(key) === queued) this.jobs.delete(key)
      }
      void promise.then(forget, forget)
      queueMicrotask(() => this.drain())
    }
    this.addPriority(job, priority, signal)
    return job.promise
  }

  private addPriority(job: PreviewJob, priority: DrawingPreviewPriority, signal?: AbortSignal): void {
    if (signal?.aborted) return
    const rank = priorities[priority]
    const token = Symbol()
    job.priorities.set(token, rank)
    if (!signal) return
    const disown = () => { job.priorities.delete(token) }
    const cleanup = () => signal.removeEventListener('abort', disown)
    signal.addEventListener('abort', disown, { once: true })
    void job.promise.then(cleanup, cleanup)
  }

  private drain(): void {
    if (this.running) return
    let next: PreviewJob | undefined
    let rank = Number.POSITIVE_INFINITY
    for (const job of this.waiting) {
      const candidate = job.priorities.size ? Math.min(...job.priorities.values()) : priorities.background
      if (candidate < rank) {
        next = job
        rank = candidate
      }
    }
    if (!next) return
    this.waiting.delete(next)
    this.running = true
    const job = next
    const timeout = setTimeout(() => job.reject(new Error('Drawing preview timed out')), PREVIEW_TIMEOUT_MS)
    void Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
      clearTimeout(timeout)
      this.running = false
      this.drain()
    })
  }
}
