import type { PagePreviews } from '../../editor/pagePreviews';
import type { ILoadedImage } from './images';
import { getUniqueId } from '../../utils';

interface IImageBinding {
    scope: HTMLElement;
    apply: (placeholder: HTMLElement, result: ILoadedImage) => void;
}

/** Pending callbacks follow their placeholders within one editor, including synchronous DOM moves. */
export class ImageMounts {
    private _bindings = new Map<string, IImageBinding>();
    private _observer: MutationObserver | null = null;
    private _pruneScheduled = false;
    private _disposed = false;
    private _blockMounts = new WeakMap<HTMLElement, AbortController>();
    private _managed = new Map<string, () => void>();

    constructor(private _root: HTMLElement) {}

    get size(): number {
        return this._bindings.size + this._managed.size;
    }

    /** The returned ID must be mounted in scope before the next microtask. */
    watch(scope: HTMLElement, request: Promise<ILoadedImage | null> | (() => Promise<ILoadedImage | null>), apply: IImageBinding['apply'], page?: PagePreviews): string {
        const id = getUniqueId();
        if (this._disposed)
            return id;
        if (page) {
            const mounts = this._blockMounts.get(scope) ?? new AbortController();
            this._blockMounts.set(scope, mounts);
            const task = new AbortController();
            const cancel = () => {
                task.abort();
                this._managed.delete(id);
            };
            this._managed.set(id, cancel);
            const unregister = page.onDispose(cancel, scope);
            mounts.signal.addEventListener('abort', cancel, { once: true });
            void this._mountInPage(page, scope, id, task.signal, request, apply).finally(() => {
                unregister();
                mounts.signal.removeEventListener('abort', cancel);
                this._managed.delete(id);
            });
            return id;
        }
        this._bindings.set(id, { scope, apply });
        if (!this._observer) {
            this._observer = new MutationObserver((records) => {
                if (records.some(record => record.removedNodes.length > 0))
                    this._prune();
            });
            this._observer.observe(this._root, { childList: true, subtree: true });
        }
        // Rendering may be abandoned before any DOM mutation reaches the observer.
        if (!this._pruneScheduled) {
            this._pruneScheduled = true;
            queueMicrotask(() => {
                this._pruneScheduled = false;
                this._prune();
            });
        }
        const loading = typeof request === 'function' ? request() : request;
        void loading.then((result) => {
            const binding = this._bindings.get(id);
            this._bindings.delete(id);
            this._disconnectIfIdle();
            if (!binding || !result)
                return;
            // Completion can run before the observer delivers a pending removal.
            const placeholder = this._placeholder(id, binding);
            if (placeholder?.isConnected)
                binding.apply(placeholder, result);
        });
        return id;
    }

    replaceBlockMounts(scope: HTMLElement): void {
        this._blockMounts.get(scope)?.abort();
        this._blockMounts.delete(scope);
    }

    private async _mountInPage(
        page: PagePreviews,
        scope: HTMLElement,
        id: string,
        signal: AbortSignal,
        request: Promise<ILoadedImage | null> | (() => Promise<ILoadedImage | null>),
        apply: IImageBinding['apply'],
    ): Promise<void> {
        await Promise.resolve();
        const placeholder = scope.querySelector<HTMLElement>(`#${id}`);
        if (!placeholder || signal.aborted || !page.owns(placeholder))
            return;
        if (typeof request === 'function') {
            const visible = await page.whenVisible(placeholder, true, signal);
            if (!visible || signal.aborted)
                return;
        }
        const result = await (typeof request === 'function' ? request() : request);
        if (!result || signal.aborted)
            return;
        const visible = await page.whenVisible(placeholder, false, signal);
        if (visible && !signal.aborted && scope.contains(placeholder))
            page.commit(placeholder, () => apply(placeholder, result));
    }

    private _placeholder(id: string, binding: IImageBinding): HTMLElement | null {
        return this._root.contains(binding.scope) ? binding.scope.querySelector<HTMLElement>(`#${id}`) : null;
    }

    private _prune(): void {
        for (const [id, binding] of this._bindings) {
            if (!this._placeholder(id, binding))
                this._bindings.delete(id);
        }
        this._disconnectIfIdle();
    }

    private _disconnectIfIdle(): void {
        if (this._bindings.size === 0) {
            this._observer?.disconnect();
            this._observer = null;
        }
    }

    clear(): void {
        for (const cancel of this._managed.values())
            cancel();
        this._bindings.clear();
        this._disconnectIfIdle();
    }

    dispose(): void {
        this._disposed = true;
        this.clear();
    }
}
