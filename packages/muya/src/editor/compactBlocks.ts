import type { Muya } from '../muya';
import type { ICodeFenceAnnotations } from '../utils/codeFenceAnnotations';
import { findScrollContainer, getBlock } from '../utils/dom';

interface IImageProbe {
    viewport: HTMLElement;
    image: HTMLImageElement;
    top: number;
    left: number;
}

function codeHeightLimit(viewport: HTMLElement, body: HTMLElement, lines: number): number | null {
    if (lines === 0)
        return null;
    const limit = Number.parseFloat(getComputedStyle(body).lineHeight) * lines;
    if (body.clientHeight <= Math.round(limit))
        return null;
    // A horizontal scrollbar takes up space below the requested rows.
    return limit + viewport.offsetHeight - viewport.clientHeight;
}

// A scrollbar may be the only reason a responsive image fits. Check borderline
// images together at the width they would regain without it.
function measureUncappedImages(probes: IImageProbe[], limit: number, heights: Map<HTMLElement, number | null>): void {
    for (const { viewport } of probes)
        viewport.classList.remove('mu-compact-limited');
    for (const { viewport, image } of probes)
        heights.set(viewport, image.offsetHeight > Math.round(limit) ? limit : null);
    for (const { viewport } of probes)
        viewport.classList.add('mu-compact-limited');
}

export class CompactBlocks {
    private _codeLimits = new WeakMap<HTMLElement, number>();
    private _bodies = new Map<HTMLElement, HTMLElement>();
    private _observer?: ResizeObserver;
    private _pending = new Set<HTMLElement>();
    private _frame?: number;

    constructor(private _muya: Muya) {
        _muya.eventCenter.attachDOMEvent(_muya.domNode, 'click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement))
                return;
            const body = target.classList.contains('mu-inline-image') ? target.parentElement : target;
            if (!body?.matches('.mu-compact-limited > .mu-compact-image-body'))
                return;
            const image = body.querySelector('img');
            if (!image)
                return;
            event.preventDefault();
            event.stopPropagation();
            _muya.eventCenter.emit('preview-image', { data: image.src });
        }, true);
        if (typeof ResizeObserver !== 'undefined') {
            this._observer = new ResizeObserver((entries) => {
                for (const { target } of entries) {
                    const viewport = target.parentElement;
                    if (viewport && this._bodies.get(viewport) === target)
                        this._pending.add(viewport);
                }
                if (this._frame === undefined)
                    this._frame = requestAnimationFrame(() => this._flush());
            });
        }
    }

    private _flush(): void {
        this._frame = undefined;
        this._measure(this._pending);
        this._pending.clear();
    }

    // Watch the uncapped body so edits, image loads and line wrapping still report their full height.
    track(viewport: HTMLElement, body: HTMLElement | null): void {
        const previous = this._bodies.get(viewport);
        if (previous === body)
            return;
        if (previous)
            this._observer?.unobserve(previous);
        if (body) {
            this._bodies.set(viewport, body);
            this._observer?.observe(body);
        }
        else if (previous) {
            this._bodies.delete(viewport);
            this._clear(viewport);
            viewport.classList.remove('mu-compact-expanded');
        }
    }

    prune(): void {
        for (const [viewport, body] of this._bodies) {
            if (!this._muya.domNode.contains(viewport)) {
                this._observer?.unobserve(body);
                this._bodies.delete(viewport);
            }
        }
    }

    refresh(viewports: Iterable<HTMLElement> = this._bodies.keys()): void {
        this._measure(viewports);
    }

    setCodeLimit(viewport: HTMLElement, lines: ICodeFenceAnnotations['maxLines']): void {
        if (lines === undefined)
            this._codeLimits.delete(viewport);
        else
            this._codeLimits.set(viewport, lines === 'none' ? 0 : lines);
        if (viewport.isConnected)
            this._measure([viewport]);
    }

    private _measure(viewports: Iterable<HTMLElement>): void {
        const { compactMode, compactImageMaxHeight, compactCodeMaxLines } = this._muya.options;
        // Image loads and window resizes arrive in batches. Finish geometry reads
        // before changing any cap, since one cap can invalidate the whole editor's layout.
        const heights = new Map<HTMLElement, number | null>();
        const probes: IImageProbe[] = [];
        const imageLimit = compactMode ? compactImageMaxHeight ?? 0 : 0;
        const defaultLines = compactMode ? compactCodeMaxLines ?? 12 : 0;
        const roundedLimit = Math.round(imageLimit);
        for (const viewport of viewports) {
            const body = this._bodies.get(viewport);
            if (!body)
                continue;
            if (viewport.classList.contains('mu-code')) {
                heights.set(viewport, codeHeightLimit(viewport, body, this._codeLimits.get(viewport) ?? defaultLines));
                continue;
            }
            if (imageLimit === 0) {
                heights.set(viewport, null);
                continue;
            }
            const image = body.querySelector('img');
            const limited = image && image.offsetHeight > roundedLimit;
            heights.set(viewport, limited ? imageLimit : null);
            if (image && !limited && viewport.matches('.mu-compact-limited:not(.mu-compact-expanded)'))
                probes.push({ viewport, image, top: viewport.scrollTop, left: viewport.scrollLeft });
        }
        measureUncappedImages(probes, imageLimit, heights);
        for (const [viewport, height] of heights) {
            if (height === null)
                this._clear(viewport);
            else
                this._applyLimit(viewport, height);
        }
        for (const { viewport, top, left } of probes) {
            if (top || left)
                viewport.scrollTo({ top, left, behavior: 'instant' });
        }
    }

    private _applyLimit(viewport: HTMLElement, height: number): void {
        const owner = viewport.parentElement;
        if (!owner)
            return;
        viewport.style.setProperty('--mu-compact-height', `${height}px`);
        viewport.classList.add('mu-compact-limited');
        let button = owner.querySelector<HTMLButtonElement>(':scope > .mu-compact-toggle');
        if (!button) {
            button = owner.ownerDocument.createElement('button');
            button.type = 'button';
            button.contentEditable = 'false';
            button.className = 'mu-compact-toggle mu-copy-remove mu-output-remove';
            button.addEventListener('mousedown', event => event.preventDefault());
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ')
                    event.stopPropagation();
            });
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this._toggle(viewport, event.currentTarget as HTMLButtonElement);
            });
            owner.append(button);
        }
        this._updateButton(viewport, button);
    }

    private _toggle(viewport: HTMLElement, button: HTMLButtonElement): void {
        const previousTop = button.getBoundingClientRect().top;
        const expanded = viewport.classList.toggle('mu-compact-expanded');
        this._updateButton(viewport, button);
        if (!expanded) {
            // Document-end clamping and native scroll anchoring may have absorbed part of the shift.
            const shift = button.getBoundingClientRect().top - previousTop;
            const scroller = findScrollContainer(this._muya.domNode, button.ownerDocument.documentElement);
            scroller.scrollBy({ top: shift, behavior: 'instant' });
        }
    }

    private _updateButton(viewport: HTMLElement, button: HTMLButtonElement): void {
        const expanded = viewport.classList.contains('mu-compact-expanded');
        const readingCode = this._muya.isReadOnly && viewport.classList.contains('mu-code');
        const label = this._muya.i18n.t(expanded ? 'Collapse' : readingCode ? 'Expand all' : 'Expand');
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    private _clear(viewport: HTMLElement): void {
        if (!viewport.classList.contains('mu-compact-limited'))
            return;
        viewport.classList.remove('mu-compact-limited');
        viewport.style.removeProperty('--mu-compact-height');
        viewport.parentElement?.querySelector(':scope > .mu-compact-toggle')?.remove();
    }

    expandedPaths(): string[] {
        const paths: string[] = [];
        for (const viewport of this._bodies.keys()) {
            const block = getBlock(viewport.parentElement);
            if (block?.parent && viewport.classList.contains('mu-compact-expanded'))
                paths.push(JSON.stringify(block.path));
        }
        return paths;
    }

    restoreExpandedPaths(paths: string[]): void {
        if (!paths.length)
            return;
        const expanded = new Set(paths);
        const restored: HTMLElement[] = [];
        for (const viewport of this._bodies.keys()) {
            const block = getBlock(viewport.parentElement);
            if (block?.parent && expanded.has(JSON.stringify(block.path))) {
                viewport.classList.add('mu-compact-expanded');
                restored.push(viewport);
            }
        }
        this._measure(restored);
    }

    dispose(): void {
        this._observer?.disconnect();
        if (this._frame !== undefined)
            cancelAnimationFrame(this._frame);
        this._pending.clear();
        this._bodies.clear();
    }
}
