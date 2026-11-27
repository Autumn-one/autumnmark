import { getUniqueId } from '../../utils';
import { isInlineDrawingSource } from '../../utils/diagram/drawingData';
import { loadImage } from '../../utils/image';

const MAX_DETACHED_INLINE_DRAWINGS = 24;

export interface ILoadedImage {
    readonly id: string;
    readonly isSuccess: boolean;
    readonly url?: string;
    readonly width?: number;
    readonly height?: number;
}

export interface IImageRevalidationResult {
    readonly result: ILoadedImage;
    readonly changed: boolean;
}

type ImageState = { status: 'pending'; request: Promise<ILoadedImage | null> }
    | { status: 'ready' | 'failed'; result: ILoadedImage };

/** Resource identity is independent of DOM occurrences; failed loads remain retryable. */
export class ImageResources {
    private _states = new Map<string, ImageState>();
    private _previews = new Map<string, string>();
    private _inlineDrawingOrder = new Set<string>();
    private _revalidateGeneration = new Map<string, number>();
    private _resultVersions = new WeakMap<ILoadedImage, { epoch: number; version: number }>();
    private _epoch = 0;
    private _disposed = false;

    constructor(private _isPinned?: (src: string) => boolean) {}

    get size(): number {
        return this._states.size;
    }

    get(src: string): ILoadedImage | undefined {
        const state = this._states.get(src);
        if (!state || state.status === 'pending')
            return undefined;
        if (state.status === 'ready' && this._inlineDrawingOrder.has(src)) {
            this._inlineDrawingOrder.delete(src);
            this._inlineDrawingOrder.add(src);
        }
        return state.result;
    }

    getPreview(src: string): string | undefined {
        return this._previews.get(src);
    }

    setPreview(src: string, preview: string): void {
        if (!this._disposed)
            this._previews.set(src, preview);
    }

    isCurrent(src: string, result: ILoadedImage): boolean {
        const version = this._resultVersions.get(result);
        return version?.epoch === this._epoch && version.version === (this._revalidateGeneration.get(src) ?? 0);
    }

    request(src: string, detectContentType: boolean, resolve?: () => Promise<string>): Promise<ILoadedImage | null> {
        if (this._disposed)
            return Promise.resolve(null);
        const state = this._states.get(src);
        if (state?.status === 'ready')
            return Promise.resolve(state.result);
        if (state?.status === 'pending')
            return state.request;
        const id = getUniqueId();
        const epoch = this._epoch;
        const version = this._revalidateGeneration.get(src) ?? 0;
        // Only the load URL is busted; repeated renders share the original key.
        const loadSrc = /^file:\/\//i.test(src)
            ? `${src}${src.includes('?') ? '&' : '?'}mucache=${id}`
            : src;
        const loading = resolve
            ? Promise.resolve().then(resolve).then(url => loadImage(url))
            : loadImage(loadSrc, detectContentType);
        const request = loading.then(
            result => ({ id, isSuccess: true, ...result }),
            () => ({ id, isSuccess: false }),
        ).then((result) => {
            const current = this._states.get(src);
            // Invalidated requests cannot repopulate caches or update DOM.
            if (current?.status !== 'pending' || current.request !== request)
                return epoch === this._epoch ? this.get(src) ?? null : null;
            this._previews.delete(src);
            this._resultVersions.set(result, { epoch, version });
            this._states.set(src, { status: result.isSuccess ? 'ready' : 'failed', result });
            if (result.isSuccess && isInlineDrawingSource(src))
                this._trackInlineDrawing(src);
            return result;
        });
        this._states.set(src, { status: 'pending', request });
        return request;
    }

    /** Reload an image while preserving its cached ready entry until the new load succeeds. */
    async revalidate(src: string, resolve: () => Promise<string>): Promise<IImageRevalidationResult | null> {
        if (this._disposed)
            return null;
        const epoch = this._epoch;
        const generation = (this._revalidateGeneration.get(src) ?? 0) + 1;
        this._revalidateGeneration.set(src, generation);
        try {
            const url = await Promise.resolve().then(resolve);
            const previous = this._states.get(src);
            const loaded = previous?.status === 'ready' && previous.result.url === url
                ? previous.result
                : await loadImage(url);
            if (this._disposed || epoch !== this._epoch || this._revalidateGeneration.get(src) !== generation)
                return null;
            const current = this._states.get(src);
            const previousUrl = current?.status === 'ready' ? current.result.url : undefined;
            const result: ILoadedImage = { ...loaded, id: getUniqueId(), isSuccess: true };
            this._resultVersions.set(result, { epoch, version: generation });
            this._previews.delete(src);
            this._states.set(src, { status: 'ready', result });
            if (isInlineDrawingSource(src))
                this._trackInlineDrawing(src);
            return { result, changed: result.url !== previousUrl };
        }
        catch {
            if (this._disposed || epoch !== this._epoch || this._revalidateGeneration.get(src) !== generation)
                return null;
            if (!this._states.has(src))
                this._states.set(src, { status: 'failed', result: { id: getUniqueId(), isSuccess: false } });
            return null;
        }
    }

    private _trackInlineDrawing(src: string): void {
        this._inlineDrawingOrder.delete(src);
        this._inlineDrawingOrder.add(src);
        const detached: string[] = [];
        for (const key of this._inlineDrawingOrder) {
            const state = this._states.get(key);
            if (state?.status !== 'ready') {
                this._inlineDrawingOrder.delete(key);
                continue;
            }
            if (!this._isPinned?.(key))
                detached.push(key);
        }
        const excess = detached.length - MAX_DETACHED_INLINE_DRAWINGS;
        for (let i = 0; i < excess; i++) {
            const key = detached[i];
            this._inlineDrawingOrder.delete(key);
            this._states.delete(key);
        }
    }

    invalidate(): void {
        this._epoch += 1;
        this._revalidateGeneration.clear();
        this._inlineDrawingOrder.clear();
        this._states.clear();
        this._previews.clear();
    }

    dispose(): void {
        this._disposed = true;
        this.invalidate();
    }
}
