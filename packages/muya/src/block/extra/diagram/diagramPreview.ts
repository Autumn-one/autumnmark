import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import type { IPreviewDiagramPayload } from '../../../ui/previewToolBar';
import type DiagramBlock from './index';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import { abbreviateEmbeddedImages, abbreviatePreviewText } from '../../../utils/embeddedImage';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import { embeddedDrawingFor } from './embedded';

const debug = logger('diagramPreview:');

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _rendered = false;
    private _cancelFinalize: (() => void) | null = null;
    private _drawingRender = 0;
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
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
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

    private async _showDrawing(code: string) {
        const drawing = this.muya.options.embeddedDrawing;
        const target = this.domNode!;
        if (!drawing) {
            target.textContent = code;
            return;
        }
        const render = ++this._drawingRender;
        const label = drawing.label();
        target.classList.add('mu-embedded-drawing');
        const button = target.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'mu-embedded-drawing-button';
        button.setAttribute('aria-label', label);
        button.textContent = this.muya.i18n.t('Loading...');
        target.replaceChildren(button);
        try {
            const source = await drawing.preview(code);
            if (render !== this._drawingRender)
                return;
            const image = target.ownerDocument.createElement('img');
            image.alt = label;
            image.src = source;
            button.replaceChildren(image);
        }
        catch {
            if (render === this._drawingRender)
                button.textContent = this.muya.i18n.t('Invalid Diagram Code');
        }
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        this._rendered = false;
        if (this._code !== code)
            this._code = code;

        if (this._type === 'excalidraw') {
            await this._showDrawing(code);
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
                await renderDiagram({
                    target: this.domNode!,
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                });
                this._rendered = true;
                if (this.muya.options.editEmbeddedImage)
                    abbreviatePreviewText(this.domNode!);
                this._cancelFinalize = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));
            }
            catch (error) {
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
}

export default DiagramPreview;
