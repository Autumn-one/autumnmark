interface IPreviewWaiter {
    viewport: boolean;
    resolve: (visible: boolean) => void;
}

/** Deferred work belongs to a single generation of a page's block tree. */
export class PagePreviews {
    private _active = false;
    private _disposed = false;
    private _wakeScheduled = false;
    private _waiters = new Map<HTMLElement, Set<IPreviewWaiter>>();
    private _observer: IntersectionObserver | null = null;
    private _removals: MutationObserver | null = null;
    private _cleanup = new Map<() => void, HTMLElement | undefined>();
    private _pauseCallbacks = new Set<() => void>();
    private _visibility: AbortController | undefined;

    constructor(private _root: HTMLElement, private _viewport?: HTMLElement) {}

    owns(target: HTMLElement): boolean {
        return !this._disposed && this._root.contains(target);
    }

    canCommit(target: HTMLElement): boolean {
        return this._active && target.isConnected && this.owns(target);
    }

    get visibilitySignal(): AbortSignal | undefined {
        return this._visibility?.signal;
    }

    commit(target: HTMLElement, update: () => void): void {
        if (!this.canCommit(target))
            return;
        const viewport = this._viewport;
        if (!viewport || viewport.scrollTop === 0) {
            update();
            return;
        }
        const before = target.getBoundingClientRect().bottom;
        const scrollTop = viewport.scrollTop;
        const above = before <= viewport.getBoundingClientRect().top;
        update();
        if (above && target.isConnected) {
            const delta = target.getBoundingClientRect().bottom - before;
            if (delta !== 0)
                viewport.scrollTop = scrollTop + delta;
        }
    }

    setActive(active: boolean): void {
        if (this._disposed || this._active === active)
            return;
        this._active = active;
        if (active) {
            this._visibility = new AbortController();
            this._observeRemovals();
            this._scheduleWake();
        }
        else {
            this._visibility?.abort();
            this._observer?.disconnect();
            this._observer = null;
            this._removals?.disconnect();
            this._removals = null;
            for (const pause of this._pauseCallbacks)
                pause();
        }
    }

    onDispose(cleanup: () => void, owner?: HTMLElement): () => void {
        if (this._disposed) {
            cleanup();
        }
        else {
            this._cleanup.set(cleanup, owner);
            this._observeRemovals();
        }
        return () => {
            this._cleanup.delete(cleanup);
        };
    }

    onPause(pause: () => void): () => void {
        this._pauseCallbacks.add(pause);
        return () => {
            this._pauseCallbacks.delete(pause);
        };
    }

    whenVisible(target: HTMLElement, viewport = false, signal?: AbortSignal): Promise<boolean> {
        if (!this.owns(target) || signal?.aborted)
            return Promise.resolve(false);
        const observe = viewport && !!this._viewport && typeof IntersectionObserver === 'function';
        if (this.canCommit(target) && !observe)
            return Promise.resolve(true);

        return new Promise((resolve) => {
            const waiters = this._waiters.get(target) ?? new Set<IPreviewWaiter>();
            const waiter: IPreviewWaiter = { viewport: observe, resolve };
            const abort = () => {
                waiters.delete(waiter);
                if (waiters.size === 0) {
                    this._waiters.delete(target);
                    this._observer?.unobserve(target);
                }
                waiter.resolve(false);
            };
            waiter.resolve = (visible) => {
                signal?.removeEventListener('abort', abort);
                resolve(visible);
            };
            waiters.add(waiter);
            this._waiters.set(target, waiters);
            signal?.addEventListener('abort', abort, { once: true });
            this._observeRemovals();
            this._scheduleWake();
        });
    }

    private _observeRemovals(): void {
        if (!this._active || this._removals || (!this._cleanup.size && !this._waiters.size))
            return;
        this._removals = new MutationObserver((records) => {
            if (!this._active || !records.some(record => record.removedNodes.length))
                return;
            for (const [cleanup, owner] of this._cleanup) {
                if (owner && !this.owns(owner)) {
                    this._cleanup.delete(cleanup);
                    cleanup();
                }
            }
            this._scheduleWake();
        });
        this._removals.observe(this._root, { childList: true, subtree: true });
    }

    private _scheduleWake(): void {
        if (!this._active || this._wakeScheduled || this._waiters.size === 0)
            return;
        this._wakeScheduled = true;
        queueMicrotask(() => {
            this._wakeScheduled = false;
            if (!this._active)
                return;
            for (const target of this._waiters.keys())
                this._wake(target, false);
        });
    }

    private _wake(target: HTMLElement, inViewport: boolean): void {
        const waiters = this._waiters.get(target);
        if (!waiters)
            return;
        const visible = this.canCommit(target);
        for (const waiter of waiters) {
            if (!visible || !waiter.viewport || inViewport) {
                waiters.delete(waiter);
                waiter.resolve(visible);
            }
        }
        if (waiters.size === 0) {
            this._waiters.delete(target);
            this._observer?.unobserve(target);
            return;
        }
        this._observer ??= new IntersectionObserver((entries, observer) => {
            if (observer !== this._observer)
                return;
            for (const entry of entries) {
                if (entry.isIntersecting && entry.target instanceof HTMLElement)
                    this._wake(entry.target, true);
            }
        }, { root: this._viewport, rootMargin: '160px 0px' });
        this._observer.observe(target);
    }

    dispose(): void {
        this.setActive(false);
        this._disposed = true;
        for (const cleanup of this._cleanup.keys())
            cleanup();
        this._cleanup.clear();
        this._pauseCallbacks.clear();
        for (const waiters of this._waiters.values()) {
            for (const waiter of waiters)
                waiter.resolve(false);
        }
        this._waiters.clear();
    }
}
