import type { Muya } from '../muya';
import { findScrollContainer, getBlock } from '../utils/dom';

export class CompactBlocks {
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
        for (const viewport of this._pending) {
            const body = this._bodies.get(viewport);
            if (body)
                this._measure(viewport, body);
        }
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

    refresh(): void {
        for (const [viewport, body] of this._bodies)
            this._measure(viewport, body);
    }

    private _measure(viewport: HTMLElement, body: HTMLElement): void {
        const { compactMode, compactImageMaxHeight, compactCodeMaxLines } = this._muya.options;
        const owner = viewport.parentElement;
        if (!owner)
            return;
        if (!compactMode) {
            this._clear(viewport);
            return;
        }
        const code = viewport.classList.contains('mu-code');
        const limit = code
            ? Number.parseFloat(getComputedStyle(body).lineHeight) * (compactCodeMaxLines ?? 12)
            : (compactImageMaxHeight ?? 320);
        const naturalHeight = code
            ? body.clientHeight
            : body.querySelector('img')?.offsetHeight ?? 0;
        if (naturalHeight <= Math.round(limit)) {
            this._clear(viewport);
            return;
        }
        // The horizontal scrollbar occupies space in addition to the requested number of code rows.
        const height = limit + (code ? viewport.offsetHeight - viewport.clientHeight : 0);
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
        const label = this._muya.i18n.t(expanded ? 'Collapse' : 'Expand');
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
        for (const [viewport, body] of this._bodies) {
            const block = getBlock(viewport.parentElement);
            if (block?.parent && expanded.has(JSON.stringify(block.path))) {
                viewport.classList.add('mu-compact-expanded');
                this._measure(viewport, body);
            }
        }
    }

    dispose(): void {
        this._observer?.disconnect();
        if (this._frame !== undefined)
            cancelAnimationFrame(this._frame);
        this._pending.clear();
        this._bodies.clear();
    }
}
