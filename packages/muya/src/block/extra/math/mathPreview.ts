import type { Muya } from '../../../muya';
import type { IMathBlockState, TState } from '../../../state/types';
import katex from 'katex';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES } from '../../../config';
import { escapeHTML } from '../../../utils';
import { abbreviateEmbeddedImages } from '../../../utils/embeddedImage';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import 'katex/dist/contrib/mhchem.mjs';

const debug = logger('mathPreview:');

const MAX_BLOCK_MATH_CACHE = 256;
const blockMathHtmlCache = new Map<string, string>();

function renderBlockMathHtml(preview: string): string {
    const cached = blockMathHtmlCache.get(preview);
    if (cached !== undefined) {
        blockMathHtmlCache.delete(preview);
        blockMathHtmlCache.set(preview, cached);
        return cached;
    }
    const html = katex.renderToString(preview, {
        displayMode: true,
    });
    if (blockMathHtmlCache.size >= MAX_BLOCK_MATH_CACHE) {
        const oldest = blockMathHtmlCache.keys().next().value;
        if (oldest !== undefined)
            blockMathHtmlCache.delete(oldest);
    }
    blockMathHtmlCache.set(preview, html);
    return html;
}

class MathPreview extends Parent {
    private _math: string;

    static override blockName = 'math-preview';

    static create(muya: Muya, state: IMathBlockState) {
        const mathBlock = new MathPreview(muya, state);

        return mathBlock;
    }

    override get path() {
        debug.warn('You can never call `get path` in htmlPreview');
        return [];
    }

    constructor(muya: Muya, { text }: IMathBlockState) {
        super(muya);
        this.tagName = 'div';
        this._math = text;
        this.classList = ['mu-math-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in mathPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
    }

    clickHandler(event: Event) {
        if (this.muya.isReadOnly)
            return;
        event.preventDefault();
        event.stopPropagation();

        const cursorBlock = this.parent!.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    update(math = this._math) {
        if (this._math !== math)
            this._math = math;

        const { i18n } = this.muya;

        if (math) {
            try {
                const preview = this.muya.options.editEmbeddedImage ? abbreviateEmbeddedImages(math) : math;
                this.domNode!.innerHTML = renderBlockMathHtml(preview);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : i18n.t('Invalid Mathematical Formula');
                this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_MATH_ERROR}">${escapeHTML(message)}</div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Mathematical Formula',
            )} &gt;</div>`;
        }
    }
}

export default MathPreview;
