import type { Muya } from '../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import { adjustOffset } from '../../../utils';
import { inlineDrawingToMarkdown } from '../../../utils/diagram/drawingSource';
import logger from '../../../utils/logger';
import { loadLanguage } from '../../../utils/prism';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';
import { embeddedDrawingFor } from './embedded';

const debug = logger('diagram:');

class DiagramBlock extends Parent {
    public meta: IDiagramMeta;
    static override blockName = 'diagram';

    static create(muya: Muya, state: IDiagramState) {
        const diagramBlock = new DiagramBlock(muya, state);
        const { lang } = state.meta;
        const diagramPreview = ScrollPage.loadBlock('diagram-preview').create(
            muya,
            state,
        );
        const diagramContainer = ScrollPage.loadBlock('diagram-container').create(
            muya,
            state,
        );

        diagramBlock.appendAttachment(diagramPreview);
        diagramBlock.append(diagramContainer);
        if (state.meta.type === 'excalidraw' && muya.options.embeddedDrawing)
            diagramBlock._addDrawingGap();

        !!lang
        && loadLanguage(lang)
            .then((infoList) => {
                if (!Array.isArray(infoList))
                    return;
                const needRender = infoList.some(
                    ({ status }) => status === 'loaded' || status === 'cached',
                );
                if (needRender)
                    diagramBlock.lastContentInDescendant()?.update();
            })
            .catch((err) => {
                debug.warn(err);
            });

        return diagramBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, { meta }: IDiagramState) {
        super(muya);
        this.tagName = 'figure';
        this.meta = meta;
        this.classList = ['mu-diagram-block'];
        if (meta.type === 'excalidraw' && muya.options.embeddedDrawing)
            this.classList.push('mu-embedded-drawing-block');
        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    private _hasAdjacentDrawing(backwards: boolean): boolean {
        const sibling = backwards ? this.prev : this.next;
        return !!sibling?.isParent() && sibling.blockName === 'diagram'
            && embeddedDrawingFor(sibling.firstContentInDescendant()) === sibling;
    }

    private _addDrawingGap() {
        const figure = this.domNode!;
        const gap = figure.ownerDocument.createElement('div');
        gap.className = 'mu-embedded-drawing-gap';
        gap.contentEditable = 'false';
        gap.onmousedown = (event) => {
            if (event.button !== 0 || event.shiftKey || !this.muya.canMutate)
                return;
            this.muya.flush();
            if (!this.muya.isBlockInDocument(this) || !this._hasAdjacentDrawing(false))
                return;
            event.preventDefault();
            event.stopPropagation();
            this.moveCaretOutside(false);
        };
        figure.append(gap);
    }

    moveCaretOutside(backwards: boolean, event?: KeyboardEvent) {
        const source = this.firstContentInDescendant();
        const parent = this.parent;
        if (!source || !parent || !this.muya.canMutate)
            return;

        this.muya.transact(() => {
            // A visible text search can land past the entire run of drawings.
            let target = this._hasAdjacentDrawing(backwards)
                ? null
                : backwards ? source.previousContentInContext(true) : source.nextContentInContext(true);
            if (!target) {
                const paragraph = ScrollPage.loadBlock('paragraph').create(this.muya, { name: 'paragraph', text: '' });
                if (backwards)
                    parent.insertBefore(paragraph, this);
                else
                    parent.insertAfter(paragraph, this);
                target = paragraph.firstContentInDescendant();
            }
            if (target) {
                const offset = backwards ? target.text.length : event ? adjustOffset(0, target, event) : 0;
                target.setCursor(offset, offset, true);
            }
        });
    }

    moveCaretBesideDrawing(before: boolean) {
        const source = this.firstContentInDescendant();
        const drawing = this.muya.options.embeddedDrawing;
        if (!source || !drawing || !this.muya.canMutate)
            return;
        // Entering the same row needs image markup so text can share it with the drawing.
        const text = inlineDrawingToMarkdown(source.text, drawing.label());
        this.muya.transact(() => {
            const paragraph = ScrollPage.loadBlock('paragraph').create(this.muya, { name: 'paragraph', text });
            this.replaceWith(paragraph);
            const offset = before ? 0 : text.length;
            paragraph.firstContentInDescendant()?.setCursor(offset, offset, true);
        });
    }

    override getState(): IDiagramState {
        const { meta } = this;
        const text = this.firstContentInDescendant()?.text;

        if (text == null)
            throw new Error('text is null when getState in diagram block.');

        return {
            name: 'diagram',
            text,
            meta,
        };
    }
}

export default DiagramBlock;
