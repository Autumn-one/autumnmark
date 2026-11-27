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
import { isInlineDrawingImage } from '../utils/diagram/drawingData';
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
    private _drawingSwaps = new WeakMap<Format, Map<number, AbortController>>();

    constructor(public muya: Muya) {
        this.renderer = new Renderer(() => {
            const selected = muya.editor.selection?.image;
            const context = muya.editor.documentContext;
            return {
                root: muya.domNode,
                readOnly: muya.isReadOnly,
                softNewlineAsSpace: muya.options.softNewlineAsSpace,
                references: this.labels,
                documentDirname: context ? context.dirname ?? '' : undefined,
                documentPathname: context?.pathname,
                resolveImagePreview: muya.options.resolveImagePreview,
                selectedImage: selected ? { block: selected.block, range: { ...selected.imageInfo.token.range } } : null,
                translate: text => muya.i18n.t(text),
            };
        }, new ImageMounts(muya.domNode), new ImageResources());

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

        const { resolveImagePreview, documentPathname } = this.renderer.environment;
        const resolve = loadFn ?? resolveImagePreview?.(newSrc, documentPathname)?.load;
        return this.renderer.images.request(newSrc, false, resolve);
    }

    /** Decode the updated inline drawing offscreen and swap it into the live wrapper. */
    async applyInlineDrawingSwap(params: {
        block: Format;
        localIndex: number;
        wrapper: HTMLElement | null;
        src: string;
        expectedRaw: string;
        attrs: Record<string, string>;
        loadPromise: Promise<ILoadedImage | null>;
    }): Promise<void> {
        const { block, localIndex } = params;
        const dom = block.domNode;
        if (!dom)
            return;
        const swaps = this._drawingSwaps.get(block) ?? new Map<number, AbortController>();
        swaps.get(localIndex)?.abort();
        const attempt = new AbortController();
        swaps.set(localIndex, attempt);
        this._drawingSwaps.set(block, swaps);
        try {
            await this._commitInlineDrawingSwap(params, dom, attempt.signal);
        }
        finally {
            if (swaps.get(localIndex) === attempt)
                swaps.delete(localIndex);
        }
    }

    private async _commitInlineDrawingSwap(
        params: Parameters<InlineEngine['applyInlineDrawingSwap']>[0],
        dom: HTMLElement,
        signal: AbortSignal,
    ): Promise<void> {
        const { block, localIndex, wrapper, src, expectedRaw, attrs, loadPromise } = params;
        const page = block.previewScope;
        const result = await loadPromise;
        if (!result?.isSuccess || !result.url)
            return;

        const resolveLiveWrapper = (): HTMLElement | null => {
            if (signal.aborted || !this.renderer.images.isCurrent(src, result)
                || !(page ? page.canCommit(dom) : dom.isConnected)) {
                return null;
            }
            if (wrapper && dom.contains(wrapper) && wrapper.getAttribute('data-raw') === expectedRaw)
                return wrapper;
            const candidate = dom.querySelectorAll<HTMLElement>('.mu-inline-drawing')[localIndex];
            return candidate?.getAttribute('data-raw') === expectedRaw ? candidate : null;
        };

        if (page && !await page.whenVisible(dom, false, signal))
            return;
        if (!resolveLiveWrapper())
            return;

        const nextImg = createImageElement(result.url, result.width, result.height, attrs);
        await decodeImageElement(nextImg);

        if (page && !await page.whenVisible(dom, false, signal))
            return;
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
    async refreshImagePreview(key: string, loadFn?: () => Promise<string>, confirmCurrent = false): Promise<boolean> {
        const { resolveImagePreview: resolvePreview, documentPathname } = this.renderer.environment;
        const page = this.muya.editor.scrollPage?.previewScope;
        const root = this.muya.editor.scrollPage?.domNode ?? this.muya.domNode;
        const canCommit = (target: HTMLElement) => page ? page.canCommit(target) : target.isConnected;
        const previewSource = (wrapper: HTMLElement) => wrapper.getAttribute('data-preview-src') ?? getImageInfo(wrapper).token.attrs.src ?? '';
        const mountedImage = (wrapper: HTMLElement): HTMLImageElement | null => {
            if (wrapper.hasAttribute('data-preview-src')) {
                const sibling = wrapper.nextElementSibling;
                return sibling instanceof HTMLImageElement ? sibling : null;
            }
            return wrapper.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER} > img`);
        };
        const matchingWrappers = (): HTMLElement[] => {
            if (!resolvePreview || !canCommit(root))
                return [];
            const matched: HTMLElement[] = [];
            const selector = `.${CLASS_NAMES.MU_INLINE_IMAGE}, .${CLASS_NAMES.MU_IMAGE_MARKED_TEXT}[data-preview-src]`;
            for (const wrapper of root.querySelectorAll<HTMLElement>(selector)) {
                if (!wrapper.getAttribute('data-raw') && !wrapper.hasAttribute('data-preview-src'))
                    continue;
                try {
                    const preview = resolvePreview(previewSource(wrapper), documentPathname);
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
                    const preview = resolvePreview(previewSource(wrapper), documentPathname);
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
        if (!outcome?.result.url || !canCommit(root))
            return false;

        const { result } = outcome;
        const fallbackBlocks = new Set<Format>();
        const wrappers = matchingWrappers();
        let changed = false;

        await Promise.all(wrappers.map(async (wrapper) => {
            const image = mountedImage(wrapper);
            if (!image) {
                const contentDom = findContentDOM(wrapper);
                const block = getBlock(contentDom);
                if (block?.isContent())
                    fallbackBlocks.add(block as Format);
                return;
            }
            if (image.getAttribute('src') === result.url)
                return;
            const nextImg = image.cloneNode(false) as HTMLImageElement;
            nextImg.src = result.url!;
            await decodeImageElement(nextImg);
            if (!canCommit(wrapper) || !this.renderer.images.isCurrent(key, result))
                return;
            try {
                if (resolvePreview?.(previewSource(wrapper), documentPathname)?.key !== key)
                    return;
            }
            catch {
                return;
            }
            const currentImg = mountedImage(wrapper);
            if (!currentImg)
                return;
            currentImg.replaceWith(nextImg);
            wrapper.classList.toggle(CLASS_NAMES.MU_SMALL_IMAGE, (result.width ?? 0) < 100 || (result.height ?? 0) < 100);
            changed = true;
        }));

        if (!canCommit(root) || !this.renderer.images.isCurrent(key, result))
            return false;
        for (const block of fallbackBlocks) {
            if (block.domNode && canCommit(block.domNode)) {
                block.update();
                changed = true;
            }
        }
        if ((!confirmCurrent && !changed) || !wrappers.length)
            return false;
        const current = matchingWrappers();
        return current.length > 0 && current.every(wrapper => mountedImage(wrapper)?.getAttribute('src') === result.url);
    }

    dispose(): void {
        this.renderer.dispose();
    }

    refreshDocumentImageSources(): void {
        this.muya.editor.scrollPage?.breadthFirstTraverse((node) => {
            if (node.isContent() && /[[!]|<(?:img|video)\b/i.test(node.text))
                node.update();
            if (node.blockName === 'html-block' && node.isParent()) {
                const preview = node.attachments.head as { update?: (html: string) => void } | null;
                preview?.update?.(node.firstContentInDescendant()?.text ?? '');
            }
        });
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this.collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const projection = projectEmbeddedImages(block);
        if (domNode)
            this.renderer.mounts.replaceBlockMounts(domNode);
        const view = projection ? { text: projection.text, blockName: block.blockName, domNode, previewScope: block.previewScope } : block;
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
