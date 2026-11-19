import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState } from '../state/types';
import type { IHighlight, Labels } from './model/types';
import { prepareReadingLinks } from '../editor/readOnly';
import logger from '../utils/logger';
import { projectEmbeddedImages } from './embeddedImages';
import { tokenizer } from './lexer';
import { profileForBlock } from './parser/profiles';
import { getReferenceDefinition, ReferenceDefinitionIndex } from './referenceDefinitions';
import Renderer from './renderer';
import { ImageMounts } from './resources/imageMounts';

const debug = logger('inlineEngine:');

class InlineEngine {
    private _labels: Labels = new Map();

    get labels(): Labels {
        return this._labels;
    }

    public renderer: Renderer;
    private _references = new ReferenceDefinitionIndex();

    constructor(public muya: Muya) {
        this.renderer = new Renderer(() => {
            const selected = muya.editor.selection?.image;
            return {
                root: muya.domNode,
                readOnly: muya.isReadOnly,
                softNewlineAsSpace: muya.options.softNewlineAsSpace,
                references: this.labels,
                selectedImage: selected ? { block: selected.block, range: { ...selected.imageInfo.token.range } } : null,
                translate: text => muya.i18n.t(text),
            };
        }, new ImageMounts(muya.domNode));
    }

    private _tokenizer(block: Pick<Format, 'text' | 'blockName'>, highlights: IHighlight[]) {
        const { options } = this.muya;
        const { text } = block;
        const { labels } = this;

        return tokenizer(text, { profile: profileForBlock(block.blockName), labels, options, highlights });
    }

    /** Invalidates pending and completed loads before repainting all image occurrences. */
    invalidateImageCache() {
        this.renderer.invalidateImages();

        const { scrollPage } = this.muya.editor;
        if (!scrollPage)
            return;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                node.update();
        });
    }

    setImagePreview(src: string, preview: string): void {
        this.renderer.images.setPreview(src, preview);
    }

    dispose(): void {
        this.renderer.dispose();
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this.collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const projection = projectEmbeddedImages(block);
        const view = projection ? { text: projection.text, blockName: block.blockName, domNode } : block;
        const ranges = projection ? highlights.map(h => ({ ...h, start: projection.offset(h.start), end: projection.offset(h.end) })) : highlights;
        const tokens = this._tokenizer(view, ranges);
        const renderCursor = !this.muya.isReadOnly && cursor?.block === block ? cursor : {};
        const caret = projection && renderCursor.anchor && renderCursor.focus
            ? { block: view, anchor: { offset: projection.offset(renderCursor.anchor.offset) }, focus: { offset: projection.offset(renderCursor.focus.offset) } }
            : renderCursor;
        const html = this.renderer.output(tokens, view, caret);
        domNode!.innerHTML = html;
        projection?.mount(domNode!, true);

        if (this.muya.isReadOnly)
            prepareReadingLinks(domNode!);
    }

    collectReferenceDefinitions(): Labels {
        this._labels = this._references.collect(this.muya.editor.transactions.candidateState, state => this.getLabelInfo(state));
        return this.labels;
    }

    getLabelInfo(blockOrState: Pick<IParagraphState, 'text'>) {
        return getReferenceDefinition(blockOrState);
    }
}

export default InlineEngine;
