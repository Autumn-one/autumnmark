import type Format from '../block/base/format';
import type Paragraph from '../block/commonMark/paragraph';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState } from '../state/types';
import type { IHighlight, Labels, Token } from './model/types';
import type { ILoadedImage } from './resources/images';
import { CLASS_NAMES } from '../config';
import { prepareReadingLinks } from '../editor/readOnly';
import { findContentDOM, getOffsetOfParagraph } from '../selection/dom';
import { INLINE_DRAWING_DATA_PREFIX, isInlineDrawingImage } from '../utils/diagram/drawingData';
import { getBlock } from '../utils/dom';
import { decodeImageElement, getImageInfo, isImageToken } from '../utils/image';
import logger from '../utils/logger';
import { projectEmbeddedImages } from './embeddedImages';
import { tokenizer } from './lexer';
import { profileForBlock } from './parser/profiles';
import { getReferenceDefinition, ReferenceDefinitionIndex } from './referenceDefinitions';
import Renderer from './renderer';
import { ImageMounts } from './resources/imageMounts';
import { ImageResources } from './resources/images';
import { createImageElement } from './resources/mountImage';

const debug = logger('inlineEngine:');

function isStandaloneImage(tokens: Token[], isImageMarker?: (raw: string) => boolean): boolean {
    const visible = tokens.length === 1 ? tokens : tokens.filter(token => token.raw.trim());
    if (visible.length !== 1)
        return false;
    const [token] = visible;
    if (token.type === 'link' || token.type === 'reference_link' || (token.type === 'html_tag' && token.tag === 'a'))
        return isStandaloneImage(token.children ?? [], isImageMarker);
    if (isInlineDrawingImage(token))
        return false;
    return isImageToken(token) || token.type === 'reference_image' || isImageMarker?.(token.raw.trim()) === true;
}

function syncParagraphDrawingWidths(block: Format) {
    if (block.parent?.blockName === 'paragraph')
        (block.parent as Paragraph).applyDrawingWidths();
}

function addDrawingGaps(content: HTMLElement) {
    for (const drawing of content.querySelectorAll('.mu-inline-drawing')) {
        const next = drawing.nextSibling;
        if (!(next instanceof Element) || !next.matches('.mu-inline-drawing'))
            continue;
        const gap = content.ownerDocument.createElement('span');
        gap.className = 'mu-drawing-gap';
        drawing.after(gap);
    }
}

function drawingGapAt(content: HTMLElement, { target, clientX, clientY }: MouseEvent) {
    for (const gap of content.querySelectorAll('.mu-drawing-gap')) {
        if (target === gap)
            return gap;
        const rect = gap.getBoundingClientRect();
        if (clientX < rect.left || clientX >= rect.right)
            continue;
        const before = gap.previousElementSibling?.getBoundingClientRect();
        const after = gap.nextElementSibling?.getBoundingClientRect();
        if (before && after && clientY >= Math.max(before.top, after.top) && clientY < Math.min(before.bottom, after.bottom))
            return gap;
    }
}

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
                resolveImagePreview: muya.options.resolveImagePreview,
                selectedImage: selected ? { block: selected.block, range: { ...selected.imageInfo.token.range } } : null,
                translate: text => muya.i18n.t(text),
            };
        }, new ImageMounts(muya.domNode), new ImageResources(src => this._isInlineDrawingInDocument(src)));

        muya.eventCenter.attachDOMEvent(muya.domNode, 'mousedown', (event) => {
            if (muya.isReadOnly || !(event instanceof MouseEvent) || event.button !== 0 || event.shiftKey || !(event.target instanceof Element))
                return;
            const targetBlock = getBlock(event.target);
            const content = findContentDOM(event.target)
                ?? (targetBlock?.isParent() ? targetBlock.firstContentInDescendant()?.domNode : undefined);
            const gap = content && drawingGapAt(content, event);
            const block = content && getBlock(content);
            if (content && gap && block?.isContent()) {
                event.preventDefault();
                const offset = getOffsetOfParagraph(gap, content);
                block.setCursor(offset, offset, true);
            }
        }, true);
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

    /** Seed stale-while-revalidate preview and start loading before any DOM sync runs. */
    prepareInlineDrawingSwap(
        wrapper: HTMLElement | null,
        oldSrc: string,
        newSrc: string,
        loadFn?: () => Promise<string>,
    ): Promise<ILoadedImage | null> {
        const cached = this.renderer.images.get(newSrc);
        if (cached?.isSuccess)
            return Promise.resolve(cached);

        const oldUrl = wrapper?.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER} > img`)?.getAttribute('src')
            ?? this.renderer.images.get(oldSrc)?.url;
        if (oldUrl)
            this.renderer.images.setPreview(newSrc, oldUrl);

        const resolve = loadFn ?? this.renderer.environment.resolveImagePreview?.(newSrc)?.load;
        return this.renderer.images.request(newSrc, false, resolve);
    }

    /** Decode the updated inline drawing offscreen and swap it into the live wrapper. */
    async applyInlineDrawingSwap(params: {
        block: Format;
        localIndex: number;
        wrapper: HTMLElement | null;
        expectedRaw: string;
        attrs: Record<string, string>;
        loadPromise: Promise<ILoadedImage | null>;
    }): Promise<void> {
        const { block, localIndex, wrapper, expectedRaw, attrs, loadPromise } = params;
        const result = await loadPromise;
        if (!result?.isSuccess || !result.url)
            return;

        const resolveLiveWrapper = (): HTMLElement | null => {
            if (wrapper?.isConnected && wrapper.getAttribute('data-raw') === expectedRaw)
                return wrapper;
            if (!block.outMostBlock || !block.domNode?.isConnected)
                return null;
            const candidate = block.domNode.querySelectorAll<HTMLElement>('.mu-inline-drawing')[localIndex];
            return candidate?.getAttribute('data-raw') === expectedRaw ? candidate : null;
        };

        if (!resolveLiveWrapper())
            return;

        const nextImg = createImageElement(result.url, result.width, result.height, attrs);
        await decodeImageElement(nextImg);

        const live = resolveLiveWrapper();
        if (!live)
            return;

        const container = live.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`);
        if (!container)
            return;

        const currentImg = container.querySelector<HTMLImageElement>('img');
        if (currentImg) {
            if (currentImg.getAttribute('src') !== result.url || !currentImg.complete)
                currentImg.replaceWith(nextImg);
        }
        else {
            container.appendChild(nextImg);
            live.classList.remove(CLASS_NAMES.MU_IMAGE_LOADING, CLASS_NAMES.MU_IMAGE_FAIL);
            live.classList.add(CLASS_NAMES.MU_IMAGE_SUCCESS);
        }
        live.classList.toggle(CLASS_NAMES.MU_SMALL_IMAGE, (result.width ?? 0) < 100 || (result.height ?? 0) < 100);
    }

    /** Revalidate one preview key without clearing other cached images or collapsing live DOM. */
    async refreshImagePreview(key: string, loadFn?: () => Promise<string>): Promise<boolean> {
        const resolvePreview = this.muya.options.resolveImagePreview;
        const matchingWrappers = (): HTMLElement[] => {
            if (!resolvePreview)
                return [];
            const matched: HTMLElement[] = [];
            for (const wrapper of this.muya.domNode.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)) {
                if (!wrapper.getAttribute('data-raw'))
                    continue;
                try {
                    const { token } = getImageInfo(wrapper);
                    const preview = resolvePreview(token.attrs.src ?? '');
                    if (preview?.key === key)
                        matched.push(wrapper);
                }
                catch {
                    // Ignore malformed or detached image wrappers.
                }
            }
            return matched;
        };

        let resolve = loadFn;
        if (!resolve && resolvePreview) {
            for (const wrapper of matchingWrappers()) {
                try {
                    const { token } = getImageInfo(wrapper);
                    const preview = resolvePreview(token.attrs.src ?? '');
                    if (preview?.key === key) {
                        resolve = preview.load;
                        break;
                    }
                }
                catch {
                    // Continue scanning.
                }
            }
        }
        if (!resolve)
            return false;

        const outcome = await this.renderer.images.revalidate(key, resolve);
        if (!outcome || !outcome.changed || !outcome.result.url)
            return false;

        const { result } = outcome;
        const fallbackBlocks = new Set<Format>();
        const wrappers = matchingWrappers();

        await Promise.all(wrappers.map(async (wrapper) => {
            const container = wrapper.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`);
            const hasLiveImage = wrapper.classList.contains(CLASS_NAMES.MU_IMAGE_SUCCESS)
                && !!container?.querySelector('img');
            if (!hasLiveImage) {
                const contentDom = findContentDOM(wrapper);
                const block = getBlock(contentDom);
                if (block?.isContent())
                    fallbackBlocks.add(block as Format);
                return;
            }
            let attrs: Record<string, string> = {};
            try {
                const { token } = getImageInfo(wrapper);
                attrs = Object.fromEntries(
                    Object.entries(token.attrs).filter((entry): entry is [string, string] => entry[1] !== null),
                );
            }
            catch {
                return;
            }
            const nextImg = createImageElement(result.url!, result.width, result.height, attrs);
            await decodeImageElement(nextImg);
            if (!wrapper.isConnected || this.renderer.images.get(key) !== result)
                return;
            try {
                const { token } = getImageInfo(wrapper);
                if (resolvePreview?.(token.attrs.src ?? '')?.key !== key)
                    return;
            }
            catch {
                return;
            }
            const liveContainer = wrapper.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`);
            const currentImg = liveContainer?.querySelector<HTMLImageElement>('img');
            if (!currentImg)
                return;
            currentImg.replaceWith(nextImg);
            wrapper.classList.toggle(CLASS_NAMES.MU_SMALL_IMAGE, (result.width ?? 0) < 100 || (result.height ?? 0) < 100);
        }));

        for (const block of fallbackBlocks) {
            if (block.outMostBlock)
                block.update();
        }
        return true;
    }

    private _isInlineDrawingInDocument(src: string): boolean {
        const scrollPage = this.muya.editor.scrollPage;
        if (!scrollPage)
            return false;
        let found = false;
        scrollPage.depthFirstTraverse((node) => {
            if (found || !node.isContent())
                return;
            if (node.text.includes(INLINE_DRAWING_DATA_PREFIX) && node.text.includes(src))
                found = true;
        });
        return found;
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
        const standalone = block.blockName === 'paragraph.content' && isStandaloneImage(tokens, projection?.isImageMarker);
        domNode!.innerHTML = standalone ? `<span class="mu-compact-image-body">${html}</span>` : html;
        projection?.mount(domNode!, true);
        if (!this.muya.isReadOnly)
            addDrawingGaps(domNode!);
        if (block.blockName === 'paragraph.content') {
            syncParagraphDrawingWidths(block);
            this.muya.editor.compactBlocks.track(domNode!, standalone ? domNode!.firstElementChild as HTMLElement : null);
        }

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
