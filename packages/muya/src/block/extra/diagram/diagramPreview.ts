import type { Muya } from '../../../muya';
import type { IDiagramState, TDrawingWidth, TState } from '../../../state/types';
import type { IPreviewDiagramPayload } from '../../../ui/previewToolBar';
import type DiagramBlock from './index';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import { applyDrawingWidth } from '../../../utils/drawingLayout';
import { abbreviateEmbeddedImages, abbreviatePreviewText } from '../../../utils/embeddedImage';
import { decodeImageElement } from '../../../utils/image';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import { embeddedDrawingFor } from './embedded';

const debug = logger('diagramPreview:');

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _width?: TDrawingWidth;
    private _rendered = false;
    private _cancelFinalize: (() => void) | null = null;
    private _renderAttempt: AbortController | null = null;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this._width = meta.width;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        if (this._type === 'excalidraw')
            applyDrawingWidth(this.domNode!, this._width);
        this._attachDOMEvents();
        this.update();
    }

    setDrawingWidth(width?: TDrawingWidth): void {
        this._width = width;
        if (this.domNode && this._type === 'excalidraw')
            applyDrawingWidth(this.domNode, width);
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
        if (this._type === 'excalidraw' && this.muya.options.embeddedDrawing) {
            this.domNode!.addEventListener('keydown', (event) => {
                if (!(event.target instanceof Element) || !event.target.closest('.mu-embedded-drawing-button'))
                    return;
                if (event.key === 'Enter' || event.key === ' ')
                    this._openDrawing(event);
                else
                    this._navigateFromDrawing(event);
            });
        }
    }

    private _navigateFromDrawing(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || this.muya.isReadOnly)
            return;
        const rtl = this.domNode?.closest('[dir]')?.getAttribute('dir') === 'rtl';
        const backwards = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
        if (!backwards && event.key !== 'ArrowDown' && event.key !== (rtl ? 'ArrowLeft' : 'ArrowRight'))
            return;

        this.muya.flush();
        const drawing = embeddedDrawingFor(this.parent?.firstContentInDescendant());
        if (!drawing || !this.muya.isBlockInDocument(drawing))
            return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            drawing.moveCaretBesideDrawing(backwards);
        else
            drawing.moveCaretOutside(backwards, event);
    }

    private _placeCaretBesideDrawing(event: Event) {
        if (!(event instanceof MouseEvent) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !this.muya.canMutate)
            return;
        const image = this.domNode?.querySelector('img');
        const rect = image?.getBoundingClientRect();
        if (!rect || event.clientY < rect.top || event.clientY >= rect.bottom || (event.clientX >= rect.left && event.clientX < rect.right))
            return;

        this.muya.flush();
        const drawing = embeddedDrawingFor(this.parent?.firstContentInDescendant());
        if (!drawing || !this.muya.isBlockInDocument(drawing))
            return;
        const rtl = this.domNode?.closest('[dir]')?.getAttribute('dir') === 'rtl';
        event.preventDefault();
        event.stopPropagation();
        drawing.moveCaretBesideDrawing((event.clientX < rect.left) !== rtl);
    }

    clickHandler(event: Event) {
        if (this._type === 'excalidraw' && this.muya.options.embeddedDrawing) {
            if (event.target instanceof Element && event.target.closest('.mu-embedded-drawing-button'))
                this._openDrawing(event);
            else
                this._placeCaretBesideDrawing(event);
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (this.muya.isReadOnly) {
            if (this._rendered) {
                this.muya.eventCenter.emit('preview-diagram', {
                    type: this._type,
                    code: this._code,
                    preview: this.domNode!,
                    label: this.domNode!.getAttribute('aria-label'),
                } satisfies IPreviewDiagramPayload);
            }
            return;
        }

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    private _openDrawing(event: Event) {
        const { muya } = this;
        muya.flush();
        const drawing = this.parent as DiagramBlock | null;
        const code = drawing?.firstContentInDescendant();
        if (!drawing || !code || !muya.isBlockInDocument(drawing))
            return;
        event.preventDefault();
        event.stopPropagation();
        const previews = [...muya.domNode.querySelectorAll('.mu-embedded-drawing, .mu-inline-drawing')];
        muya.options.embeddedDrawing?.open(code.text, previews.indexOf(this.domNode!));
    }

    private async _showDrawing(code: string, signal: AbortSignal, previewLoader?: () => Promise<string>) {
        const drawing = this.muya.options.embeddedDrawing;
        const target = this.domNode!;
        if (!drawing) {
            target.textContent = code;
            return;
        }
        const page = this.previewScope;
        const label = drawing.label();
        target.classList.add('mu-embedded-drawing');

        let button = target.querySelector<HTMLButtonElement>(':scope > .mu-embedded-drawing-button');
        const existingImg = button?.querySelector<HTMLImageElement>(':scope > img') ?? null;
        if (!button) {
            button = target.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'mu-embedded-drawing-button';
            button.setAttribute('aria-label', label);
            button.textContent = this.muya.i18n.t('Loading...');
            target.replaceChildren(button);
        }
        else {
            button.setAttribute('aria-label', label);
            // Keep an already rendered drawing visible while the next preview exports.
            if (!existingImg)
                button.textContent = this.muya.i18n.t('Loading...');
        }

        const isCurrent = () => !signal.aborted && target.contains(button);
        const wait = async (viewport = false) => {
            if (page && !await page.whenVisible(button, viewport, signal))
                return false;
            return isCurrent() && (page ? page.canCommit(button) : button.isConnected);
        };
        await Promise.resolve();
        try {
            if (page && !await wait(!existingImg && !previewLoader))
                return;
            const source = await (previewLoader ? previewLoader() : drawing.preview(code, page?.visibilitySignal));
            if (!await wait())
                return;
            const image = target.ownerDocument.createElement('img');
            image.alt = label;
            image.src = source;
            image.draggable = false;
            await decodeImageElement(image);
            if (!await wait())
                return;
            const swap = () => {
                button.replaceChildren(image);
            };
            if (page)
                page.commit(button, swap);
            else
                swap();
        }
        catch {
            if (await wait() && !button.querySelector(':scope > img'))
                button.textContent = this.muya.i18n.t('Invalid Diagram Code');
        }
    }

    async update(code = this._code, previewLoader?: () => Promise<string>) {
        const { i18n } = this.muya;
        this._renderAttempt?.abort();
        const attempt = new AbortController();
        this._renderAttempt = attempt;
        const { signal } = attempt;
        this._rendered = false;
        if (this._code !== code)
            this._code = code;

        if (this._type === 'excalidraw') {
            await this._showDrawing(code, signal, previewLoader);
            return;
        }

        // A previous render may still be waiting for its `<svg>`; it must not
        // describe whatever this one puts in its place.
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this.domNode!.removeAttribute('role');
        this.domNode!.removeAttribute('aria-label');

        if (code) {
            this.domNode!.innerHTML = i18n.t('Loading...');
            const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            try {
                const rendered = await this._renderDiagram({
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                }, signal);
                if (!rendered)
                    return;
                this._rendered = true;
                if (this.muya.options.editEmbeddedImage)
                    abbreviatePreviewText(this.domNode!);
                const cancel = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));
                const unregister = this.previewScope?.onDispose(cancel, this.domNode!);
                this._cancelFinalize = () => {
                    unregister?.();
                    cancel();
                };
            }
            catch (error) {
                if (signal.aborted)
                    return;
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    this.muya.options.editEmbeddedImage ? abbreviateEmbeddedImages(detail) : detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }

    private async _renderDiagram(options: Omit<Parameters<typeof renderDiagram>[0], 'target'>, signal: AbortSignal): Promise<boolean> {
        const host = this.domNode!;
        const page = this.previewScope;
        if (!page) {
            await renderDiagram({ ...options, target: host });
            return !signal.aborted;
        }

        await Promise.resolve();
        while (await page.whenVisible(host, true, signal)) {
            if (signal.aborted || !page.owns(host))
                return false;
            if (!page.canCommit(host))
                continue;
            const target = host.ownerDocument.createElement('div');
            target.style.display = 'contents';
            host.appendChild(target);
            const detach = () => {
                target.remove();
            };
            const unregister = page.onPause(detach);
            signal.addEventListener('abort', detach, { once: true });
            const isCurrent = () => !signal.aborted && page.canCommit(host) && target.parentNode === host;
            try {
                await renderDiagram({ ...options, target, isCurrent });
                if (isCurrent()) {
                    page.commit(host, () => {
                        host.replaceChildren(...target.childNodes);
                    });
                    return true;
                }
            }
            catch (error) {
                if (isCurrent())
                    throw error;
            }
            finally {
                unregister();
                signal.removeEventListener('abort', detach);
                target.remove();
            }
        }
        return false;
    }
}

export default DiagramPreview;
