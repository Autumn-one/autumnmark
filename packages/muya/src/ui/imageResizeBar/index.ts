import type Paragraph from '../../block/commonMark/paragraph';
import type DiagramBlock from '../../block/extra/diagram';
import type { Muya } from '../../index';
import type { TDrawingWidth } from '../../state/types';
import type { TImageWidth } from '../../utils/image';
import { autoUpdate } from '@floating-ui/dom';
import { linkedImageAt } from '../../inline/linkedImage';
import { findContentDOM } from '../../selection/dom';
import { SelectionType } from '../../selection/types';
import { isHTMLElement, isMouseEvent } from '../../utils';

import { findScrollContainer, getBlock } from '../../utils/dom';
import { applyDrawingWidth } from '../../utils/drawingLayout';
import { embeddedImageWidths } from '../../utils/embeddedImage';
import { picturesOnRow, snapPictureWidth } from './snapping';
import './index.css';

const VERTICAL_BAR = ['left', 'right'];

const CIRCLE_RADIO = 5;
const BAR_HEIGHT = 50;
const FULL_WIDTH_SNAP_PX = 2;

interface IDrawingResizeTarget {
    container: HTMLElement;
    measureContainer: HTMLElement;
    initialWidth: TDrawingWidth | undefined;
    preview: (width: TDrawingWidth) => void;
    restore: () => void;
    commit: (width: TDrawingWidth) => void;
}

function measureAvailableWidth(container: HTMLElement): number {
    const style = getComputedStyle(container);
    const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const inner = container.clientWidth > 0
        ? container.clientWidth - padding
        : container.getBoundingClientRect().width - padding;
    return Math.max(0, Math.round(inner));
}

function measureImageAvailableWidth(image: HTMLImageElement): number {
    const compactBody = image.closest<HTMLElement>('.mu-compact-image-body');
    const content = findContentDOM(image);
    const compactWidth = compactBody ? measureAvailableWidth(compactBody) : 0;
    const container = compactWidth > 0 ? compactBody : content;
    if (!container)
        return 0;
    const cell = container.closest<HTMLElement>('.mu-table-cell');
    if (cell) {
        const table = cell.closest<HTMLElement>('.mu-table-inner');
        const hasCustomColumns = !!table?.querySelector('.mu-table-cell-fill, .mu-table-cell[style*="--mu-cell-width"]');
        const cellHasExplicitWidth = cell.classList.contains('mu-table-cell-fill')
            || cell.style.getPropertyValue('--mu-cell-width').trim().length > 0;
        // Companion columns in custom-width tables shrink-wrap their image, so dragging right would immediately snap to 100%.
        if (hasCustomColumns && !cellHasExplicitWidth)
            return 0;
    }
    return compactWidth > 0 ? compactWidth : measureAvailableWidth(container);
}

function drawingResizeTarget(muya: Muya, image: HTMLImageElement): IDrawingResizeTarget | undefined {
    const embeddedButton = image.closest<HTMLElement>('.mu-embedded-drawing-button');
    if (embeddedButton) {
        const previewDom = embeddedButton.closest<HTMLElement>('.mu-diagram-preview.mu-embedded-drawing');
        const figure = previewDom?.closest<HTMLElement>('figure.mu-embedded-drawing-block');
        const block = getBlock(figure);
        if (!previewDom || !block || block.blockName !== 'diagram' || !muya.isBlockInDocument(block))
            return;
        const diagram = block as DiagramBlock;
        if (diagram.meta.type !== 'excalidraw')
            return;
        const initialWidth = diagram.meta.width;
        return {
            container: previewDom,
            measureContainer: previewDom,
            initialWidth,
            preview: width => applyDrawingWidth(previewDom, width),
            restore: () => applyDrawingWidth(previewDom, initialWidth),
            commit: width => diagram.setDrawingWidth(width),
        };
    }

    const wrapper = image.closest<HTMLElement>('.mu-inline-drawing, .mu-linked-drawing');
    if (!wrapper)
        return;
    const contentDom = findContentDOM(wrapper);
    const contentBlock = getBlock(contentDom);
    const parent = contentBlock?.parent;
    if (!contentDom || !parent || parent.blockName !== 'paragraph' || !muya.isBlockInDocument(parent))
        return;
    const paragraph = parent as Paragraph;
    const drawings = [...contentDom.querySelectorAll<HTMLElement>('.mu-inline-drawing, .mu-linked-drawing')];
    const index = drawings.indexOf(wrapper) + 1;
    if (index < 1)
        return;
    const initialWidth = paragraph.drawingWidthAt(index);
    return {
        container: wrapper,
        measureContainer: contentDom,
        initialWidth,
        preview: width => applyDrawingWidth(wrapper, width),
        restore: () => applyDrawingWidth(wrapper, initialWidth),
        commit: width => paragraph.setDrawingWidth(index, width),
    };
}

export class ImageResizeBar {
    static pluginName = 'transformer';
    private _reference: HTMLElement | null = null;
    private _commitWidth: ((width: TImageWidth, height?: number) => void) | null = null;
    private _drawingTarget: IDrawingResizeTarget | null = null;
    private _drawingWidth: TDrawingWidth | null = null;
    private _height?: number;
    private _readout?: HTMLElement;
    private _snap: ReturnType<typeof snapPictureWidth>;

    private _movingAnchor: string | null = null;
    private _status: boolean = false;
    private _width: TImageWidth | null = null;
    // Pointer position and image width as of mousedown. Writing a width moves
    // the image's own edges, so live geometry is not a usable reference while
    // dragging — only this snapshot is (#5392).
    private _dragStart: {
        clientX: number;
        width: number;
        maxWidth: number;
        ratio: number;
        explicitHeight: boolean;
        wrapper: HTMLElement | null;
        initialFullWidth: boolean;
        initialWidthAttr: string | null;
        initialHeightAttr: string | null;
        lastX?: number;
        peers: ReturnType<typeof picturesOnRow>;
    } | null = null;

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
            if (!this.muya.isReadOnly && image?.domNode && !image.domNode.closest('.mu-inline-drawing, .mu-linked-drawing')) {
                const { block, imageInfo, domNode } = image;
                this._show(domNode, (width, height) => {
                    if (width === '100%')
                        block.updateImageAttributes(imageInfo, { width: '100%', height: undefined });
                    else if (height === undefined)
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
                : target.closest('.mu-embedded-picture-surface, .mu-inline-drawing, .mu-linked-drawing, .mu-embedded-drawing-button')?.querySelector('img');
            if (picture && domNode.contains(picture) && !this.muya.isReadOnly) {
                const drawing = drawingResizeTarget(this.muya, picture);
                if (drawing) {
                    this._showDrawing(picture, drawing);
                    return;
                }
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

    private _show(reference: HTMLElement, commit: (width: TImageWidth, height?: number) => void) {
        if (this._reference !== reference)
            this.hide();
        this._reference = reference;
        this._commitWidth = commit;
        this._drawingTarget = null;
        this._drawingWidth = null;
        setTimeout(() => {
            if (this._reference === reference)
                this._render();
        });
    }

    private _showDrawing(reference: HTMLElement, target: IDrawingResizeTarget) {
        if (this._reference !== reference)
            this.hide();
        this._reference = reference;
        this._commitWidth = null;
        this._drawingTarget = target;
        this._drawingWidth = null;
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
        const wrapper = this._drawingTarget ? null : image.closest<HTMLElement>('.mu-inline-image, .mu-embedded-picture');
        const fullWidthTarget = wrapper ?? image;
        this._dragStart = {
            clientX: event.clientX,
            width: rect.width,
            maxWidth: this._drawingTarget
                ? measureAvailableWidth(this._drawingTarget.measureContainer)
                : measureImageAvailableWidth(image),
            ratio: rect.height > 0 ? rect.width / rect.height : 1,
            explicitHeight: !this._drawingTarget && image.hasAttribute('height'),
            wrapper,
            initialFullWidth: !this._drawingTarget && fullWidthTarget.classList.contains('mu-image-full-width'),
            initialWidthAttr: image.getAttribute('width'),
            initialHeightAttr: image.getAttribute('height'),
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
        snap = this._applyResizedWidth(
            image,
            requested,
            freeWidth,
            dragStart.maxWidth,
            snap,
            this._drawingTarget
                ? width => this._setDrawingDisplayWidth(width)
                : width => this._setDisplayWidth(image, width),
        );
        if (this._snap?.element !== snap?.element) {
            this._snap?.element.classList.remove('mu-image-snap-target');
            snap?.element.classList.add('mu-image-snap-target');
        }
        this._snap = snap;
        this._update();
    }

    private _applyResizedWidth(
        image: HTMLImageElement,
        requested: number,
        freeWidth: number,
        maxWidth: number,
        snap: ReturnType<typeof snapPictureWidth>,
        apply: (width: TImageWidth) => void,
    ): ReturnType<typeof snapPictureWidth> {
        const fullWidth = maxWidth > 0 && requested >= maxWidth - FULL_WIDTH_SNAP_PX;
        let nextSnap = snap && maxWidth > 0 && snap.width >= maxWidth - FULL_WIDTH_SNAP_PX ? undefined : snap;
        const fallbackWidth: TImageWidth = fullWidth ? '100%' : freeWidth;
        apply(nextSnap?.width ?? fallbackWidth);
        if (nextSnap && Math.abs(nextSnap.element.getBoundingClientRect().top - image.getBoundingClientRect().top) >= 2) {
            // Crossing a wrap boundary can move the proposed match onto the next row.
            nextSnap = undefined;
            apply(fallbackWidth);
        }
        return nextSnap;
    }

    private _setDrawingDisplayWidth(width: TDrawingWidth) {
        this._drawingWidth = width;
        this._drawingTarget?.preview(width);
    }

    private _setDisplayWidth(image: HTMLImageElement, width: TImageWidth) {
        const fullWidthTarget = this._dragStart?.wrapper ?? image;
        this._width = width;
        if (width === '100%') {
            fullWidthTarget.classList.add('mu-image-full-width');
            image.setAttribute('width', '100%');
            this._height = undefined;
            image.removeAttribute('height');
            return;
        }
        fullWidthTarget.classList.remove('mu-image-full-width');
        image.setAttribute('width', String(width));
        if (this._dragStart?.explicitHeight && this._dragStart.ratio > 0) {
            this._height = Math.max(1, Math.round(width / this._dragStart.ratio));
            image.setAttribute('height', String(this._height));
        }
        else {
            this._height = undefined;
        }
    }

    private _restoreDisplayWidth() {
        const image = this._image;
        const dragStart = this._dragStart;
        if (!image || !dragStart)
            return;
        const fullWidthTarget = dragStart.wrapper ?? image;
        fullWidthTarget.classList.toggle('mu-image-full-width', dragStart.initialFullWidth);
        if (dragStart.initialWidthAttr === null)
            image.removeAttribute('width');
        else
            image.setAttribute('width', dragStart.initialWidthAttr);
        if (dragStart.initialHeightAttr === null)
            image.removeAttribute('height');
        else
            image.setAttribute('height', dragStart.initialHeightAttr);
    }

    private _showSize(rect: DOMRect, axis: 'width' | 'height' | null) {
        const output = this._readout;
        const handle = this._container.querySelector<HTMLElement>(`.bar.${this._movingAnchor}`);
        if (!output || !handle)
            return;
        const status = axis ? this.muya.i18n.t(axis === 'width' ? 'Same width' : 'Same height') : '';
        const dimensions = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
        const isFullWidth = this._drawingWidth === '100%' || this._width === '100%';
        const label = isFullWidth
            ? `100% (${dimensions})`
            : `${dimensions}${status ? ` · ${status}` : ''}`;
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
        this._resizing = false;

        if (this._drawingTarget) {
            const target = this._drawingTarget;
            const drawingWidth = this._drawingWidth;
            if (drawingWidth !== null && !this.muya.isReadOnly) {
                target.commit(drawingWidth);
                this.hide();
            }
            else {
                target.restore();
            }
        }
        else if (this._width !== null && this._commitWidth && !this.muya.isReadOnly) {
            if (this._width === '100%' || this._height === undefined)
                this._commitWidth(this._width);
            else
                this._commitWidth(this._width, this._height);
            this.hide();
        }
        else if (this._width !== null) {
            this._restoreDisplayWidth();
        }

        this._width = null;
        this._drawingWidth = null;
        this._dragStart = null;
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
        if (this._resizing) {
            if (this._drawingTarget)
                this._drawingTarget.restore();
            else
                this._restoreDisplayWidth();
        }
        this._cleanup?.();
        this._cleanup = null;
        this._detachResizeListeners();
        this._width = null;
        this._drawingWidth = null;
        this._height = undefined;
        this._dragStart = null;
        this._resizing = false;
        this._movingAnchor = null;
        this._reference = null;
        this._commitWidth = null;
        this._drawingTarget = null;
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
