import type { Muya } from '../../index';
import { autoUpdate } from '@floating-ui/dom';
import { linkedImageAt } from '../../inline/linkedImage';
import { SelectionType } from '../../selection/types';
import { isHTMLElement, isMouseEvent } from '../../utils';

import { findScrollContainer } from '../../utils/dom';
import { embeddedImageWidths } from '../../utils/embeddedImage';
import { picturesOnRow, snapPictureWidth } from './snapping';
import './index.css';

const VERTICAL_BAR = ['left', 'right'];

const CIRCLE_RADIO = 5;
const BAR_HEIGHT = 50;

export class ImageResizeBar {
    static pluginName = 'transformer';
    private _reference: HTMLElement | null = null;
    private _commitWidth: ((width: number, height?: number) => void) | null = null;
    private _height?: number;
    private _readout?: HTMLElement;
    private _snap: ReturnType<typeof snapPictureWidth>;

    private _movingAnchor: string | null = null;
    private _status: boolean = false;
    private _width: number | null = null;
    // Pointer position and image width as of mousedown. Writing a width moves
    // the image's own edges, so live geometry is not a usable reference while
    // dragging — only this snapshot is (#5392).
    private _dragStart: { clientX: number; width: number; ratio: number; explicitHeight: boolean; lastX?: number; peers: ReturnType<typeof picturesOnRow> } | null = null;
    private _eventId: string[] = [];
    private _resizing: boolean = false;
    // Stops the autoUpdate reposition loop set up in `_render`.
    private _cleanup: (() => void) | null = null;
    // A container for storing drag strips
    private _container: HTMLDivElement;

    constructor(public muya: Muya) {
        const container = (this._container = document.createElement('div'));
        container.classList.add('mu-transformer');
        document.body.appendChild(container);

        this._listen();
    }

    private _listen() {
        const { eventCenter, domNode } = this.muya;

        eventCenter.on('selection-change', ({ selection }) => {
            const image = selection?.kind === SelectionType.IMAGE ? selection.context : null;
            if (!this.muya.isReadOnly && image?.domNode) {
                const { block, imageInfo, domNode } = image;
                this._show(domNode, (width, height) => {
                    if (height === undefined)
                        block.updateImage(imageInfo, 'width', String(width));
                    else
                        block.updateImageAttributes(imageInfo, { width: String(width), height: String(height) });
                });
            }
            else if (!(this._reference instanceof HTMLImageElement && this._reference.isConnected) || this.muya.isReadOnly) {
                this.hide();
            }
        });

        eventCenter.attachDOMEvent(document, 'mouseover', (event) => {
            const target = event.target;
            if (!isMouseEvent(event) || event.buttons !== 0 || this._resizing || !(target instanceof Element) || this._container.contains(target))
                return;
            const picture = target instanceof HTMLImageElement
                ? target
                : target.closest('.mu-embedded-picture-surface')?.querySelector('img');
            if (picture && domNode.contains(picture) && !this.muya.isReadOnly) {
                const commit = embeddedImageWidths.get(picture) ?? linkedImageAt(this.muya, picture)?.resize;
                if (commit) {
                    this._show(picture, commit);
                    return;
                }
            }
            if (this._reference instanceof HTMLImageElement)
                this.hide();
        });
        eventCenter.attachDOMEvent(domNode, 'mousedown', () => {
            if (this._reference instanceof HTMLImageElement)
                this.hide();
        });
        eventCenter.attachDOMEvent(document, 'click', (event) => {
            if (event.target instanceof Node && (this._reference?.contains(event.target) || this._container.contains(event.target)))
                return;
            this.hide();
        });
        eventCenter.attachDOMEvent(this._container, 'dragstart', event =>
            event.preventDefault());
        eventCenter.attachDOMEvent(document.body, 'mousedown', this._mouseDown);
    }

    private _show(reference: HTMLElement, commit: (width: number, height?: number) => void) {
        if (this._reference !== reference)
            this.hide();
        this._reference = reference;
        this._commitWidth = commit;
        setTimeout(() => {
            if (this._reference === reference)
                this._render();
        });
    }

    private get _image() {
        return this._reference instanceof HTMLImageElement ? this._reference : this._reference?.querySelector('img');
    }

    private _render() {
        const { eventCenter } = this.muya;
        if (!this._reference?.isConnected) {
            this.hide();
            return;
        }
        if (this._status)
            return;

        this._status = true;

        this._createElements();
        this._update();
        // Reposition the handles whenever the image moves (window/ancestor
        // resize, sidebar toggle, scroll), so they stay attached to it (#2939).
        const compactViewport = this._reference.closest('.mu-compact-image-body')?.parentElement;
        const editorViewport = findScrollContainer(this.muya.domNode, document.documentElement);
        const update = () => this._update();
        const stopPositioning = autoUpdate(this._reference, this._container, update);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        if (editorViewport !== document.documentElement)
            observer?.observe(editorViewport);
        if (compactViewport) {
            observer?.observe(compactViewport);
            compactViewport.addEventListener('scroll', update);
        }
        this._cleanup = () => {
            stopPositioning();
            observer?.disconnect();
            compactViewport?.removeEventListener('scroll', update);
        };
        eventCenter.emit('muya-float', this, true);
    }

    private _createElements() {
        VERTICAL_BAR.forEach((c) => {
            const bar = document.createElement('div');
            bar.classList.add('bar');
            bar.classList.add(c);
            bar.setAttribute('data-position', c);
            this._container.appendChild(bar);
        });
    }

    private _update() {
        const reference = this._reference;
        if (!reference?.isConnected) {
            this.hide();
            return;
        }
        const rect = reference.getBoundingClientRect();
        const viewport = findScrollContainer(this.muya.domNode, document.documentElement);
        const viewportRect = viewport === document.documentElement ? null : viewport.getBoundingClientRect();
        const scrollportTop = viewportRect ? viewportRect.top + viewport.clientTop : 0;
        const viewportTop = Math.max(0, scrollportTop);
        const viewportBottom = viewportRect ? Math.min(window.innerHeight, scrollportTop + viewport.clientHeight) : window.innerHeight;
        const compact = reference.closest('.mu-compact-limited:not(.mu-compact-expanded)')?.getBoundingClientRect();
        const top = Math.max(rect.top, viewportTop, compact?.top ?? viewportTop);
        const bottom = Math.min(rect.bottom, viewportBottom, compact?.bottom ?? viewportBottom);
        this._container.hidden = bottom <= top;
        if (this._container.hidden)
            return;

        // The overlay lives under document.body, outside the editor's overflow clip.
        this._container.style.top = `${viewportTop}px`;
        this._container.style.bottom = `${window.innerHeight - viewportBottom}px`;
        let height = Math.min(BAR_HEIGHT, viewportBottom - viewportTop);
        if (compact || top > rect.top || bottom < rect.bottom)
            height = Math.min(height, bottom - top);
        const barTop = Math.min(Math.max(viewportTop, (top + bottom - height) / 2), viewportBottom - height);
        // Tiny pictures still need a click target between their two handles.
        const overlap = rect.width < 4 * CIRCLE_RADIO ? 0 : CIRCLE_RADIO;
        VERTICAL_BAR.forEach((c) => {
            const bar: HTMLDivElement = this._container.querySelector(`.${c}`)!;
            bar.style.height = `${height}px`;
            bar.style.top = `${barTop - viewportTop}px`;

            switch (c) {
                case 'left':
                    bar.style.left = `${rect.left - 2 * CIRCLE_RADIO + overlap}px`;
                    break;

                case 'right':
                    bar.style.left = `${rect.right - overlap}px`;
                    break;
            }
        });
        if (this._readout && this._image)
            this._showSize(this._image.getBoundingClientRect(), this._snap?.axis ?? null);
    }

    private _mouseDown = (event: Event) => {
        const { target } = event;
        const handle = isHTMLElement(target) ? target.closest('.bar') : null;
        // Document content can carry its own `.bar` elements (raw HTML, a
        // mermaid `classDef bar`); only this bar's handles start a resize (#5116).
        if (!handle || !this._container.contains(handle))
            return;

        const side = handle.getAttribute('data-position');
        if (side !== 'left' && side !== 'right')
            return;
        event.preventDefault();
        const { eventCenter } = this.muya;
        this._movingAnchor = side;
        const image = this._image;
        if (!image || !isMouseEvent(event))
            return;
        const rect = image.getBoundingClientRect();
        this._dragStart = {
            clientX: event.clientX,
            width: rect.width,
            ratio: rect.height > 0 ? rect.width / rect.height : 1,
            explicitHeight: image.hasAttribute('height'),
            peers: picturesOnRow(image, rect.top),
        };
        this._readout = document.createElement('output');
        this._readout.className = 'mu-image-size-readout';
        this._container.append(this._readout);
        this._showSize(rect, null);
        // A pointer dragged past the window's edge keeps driving the resize,
        // but those out-of-viewport coordinates hit test to `<html>`, whose
        // bubble path skips `<body>`. Listening on the document keeps the
        // release outside the window a normal release instead of a silently
        // dropped width (#5393).
        const mouseMoveId = eventCenter.attachDOMEvent(
            document,
            'mousemove',
            this._mouseMove,
        );
        const mouseUpId = eventCenter.attachDOMEvent(
            document,
            'mouseup',
            this._mouseUp,
        );
        this._resizing = true;
        this._eventId.push(mouseMoveId, mouseUpId);
        for (const type of ['keydown', 'keyup']) {
            const id = eventCenter.attachDOMEvent(document, type, (key) => {
                if (!(key instanceof KeyboardEvent) || key.key !== 'Shift')
                    return;
                // The editor's keyup handler may rebuild the image while its handle owns the drag.
                key.stopPropagation();
                if (this._dragStart?.lastX !== undefined)
                    this._resizeAt(this._dragStart.lastX, type === 'keydown');
            }, true);
            this._eventId.push(id);
        }
    };

    private _mouseMove = (event: Event) => {
        if (!isMouseEvent(event))
            return;

        if (!this._reference?.isConnected) {
            this.hide();
            return;
        }

        event.preventDefault();
        this._resizeAt(event.clientX, event.shiftKey);
    };

    private _resizeAt(clientX: number, shift: boolean) {
        const dragStart = this._dragStart;
        const image = this._image;
        if (!image?.isConnected || !dragStart)
            return;
        dragStart.lastX = clientX;
        const delta = (clientX - dragStart.clientX) * (this._movingAnchor === 'left' ? -1 : 1);
        const requested = dragStart.width + delta;
        const freeWidth = Math.max(50, Math.trunc(requested));
        let snap = shift ? snapPictureWidth(requested, dragStart.ratio, image.getBoundingClientRect().top, dragStart.peers) : undefined;
        this._setDisplayWidth(image, snap?.width ?? freeWidth);
        if (snap && Math.abs(snap.element.getBoundingClientRect().top - image.getBoundingClientRect().top) >= 2) {
            // Crossing a wrap boundary can move the proposed match onto the next row.
            snap = undefined;
            this._setDisplayWidth(image, freeWidth);
        }
        if (this._snap?.element !== snap?.element) {
            this._snap?.element.classList.remove('mu-image-snap-target');
            snap?.element.classList.add('mu-image-snap-target');
        }
        this._snap = snap;
        this._update();
    }

    private _setDisplayWidth(image: HTMLImageElement, width: number) {
        this._width = width;
        image.setAttribute('width', String(width));
        if (this._dragStart?.explicitHeight && this._dragStart.ratio > 0) {
            this._height = Math.max(1, Math.round(width / this._dragStart.ratio));
            image.setAttribute('height', String(this._height));
        }
    }

    private _showSize(rect: DOMRect, axis: 'width' | 'height' | null) {
        const output = this._readout;
        const handle = this._container.querySelector<HTMLElement>(`.bar.${this._movingAnchor}`);
        if (!output || !handle)
            return;
        const status = axis ? this.muya.i18n.t(axis === 'width' ? 'Same width' : 'Same height') : '';
        const label = `${Math.round(rect.width)} × ${Math.round(rect.height)} px${status ? ` · ${status}` : ''}`;
        if (output.textContent !== label)
            output.textContent = label;
        const bar = handle.getBoundingClientRect();
        const viewport = this._container.getBoundingClientRect();
        const x = this._movingAnchor === 'left' ? bar.left - output.offsetWidth - 6 : bar.right + 6;
        const y = bar.top - viewport.top + (bar.height - output.offsetHeight) / 2;
        output.style.left = `${Math.max(4, Math.min(x, viewport.width - output.offsetWidth - 4))}px`;
        output.style.top = `${Math.max(0, Math.min(y, viewport.height - output.offsetHeight))}px`;
    }

    private _mouseUp = (event: Event) => {
        event.preventDefault();
        if (!this._reference?.isConnected) {
            this.hide();
            return;
        }
        this._detachResizeListeners();

        if (typeof this._width === 'number' && this._commitWidth && !this.muya.isReadOnly) {
            if (this._height === undefined)
                this._commitWidth(this._width);
            else
                this._commitWidth(this._width, this._height);
            this.hide();
        }

        this._width = null;
        this._dragStart = null;
        this._resizing = false;
        this._movingAnchor = null;
    };

    private _detachResizeListeners() {
        const { eventCenter } = this.muya;
        for (const id of this._eventId)
            eventCenter.detachDOMEvent(id);

        this._eventId = [];
        this._readout?.remove();
        this._readout = undefined;
        this._snap?.element.classList.remove('mu-image-snap-target');
        this._snap = undefined;
    }

    hide() {
        const { eventCenter } = this.muya;
        this._cleanup?.();
        this._cleanup = null;
        this._detachResizeListeners();
        this._width = null;
        this._height = undefined;
        this._dragStart = null;
        this._resizing = false;
        this._movingAnchor = null;
        this._reference = null;
        this._commitWidth = null;
        const circles = this._container.querySelectorAll('.bar');
        Array.from(circles).forEach(c => c.remove());
        this._status = false;
        eventCenter.emit('muya-float', this, false);
    }

    // Remove the `.mu-transformer` container appended to document.body in the
    // constructor; invoked by `Muya.destroy()` so it is not leaked (#3315).
    destroy() {
        this._detachResizeListeners();
        this._cleanup?.();
        this._cleanup = null;
        this._container.remove();
    }
}
