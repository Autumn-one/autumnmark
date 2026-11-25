import type { Muya } from '../muya';
import type { Labels } from './model/types';
import { embeddedImageDestination, findDocumentImages } from '../clipboard/pastedImageSources';
import { findContentDOM, getOffsetOfParagraph } from '../selection/dom';
import { getBlock } from '../utils/dom';
import { imageToHtml, imageToMarkdown, isImageToken, replaceImageMarkup } from '../utils/image';
import { parseInline } from './parser/lexer';
import { normalizeReferenceLabel } from './referenceLabel';

function linkedImageSource(raw: string, labels: Labels) {
    const [token] = parseInline(raw, { labels });
    if (isImageToken(token)) {
        const source = findDocumentImages(raw)[0];
        if (!source)
            return;
        return {
            src: source.src,
            attrs: token.attrs,
            replace: (data: string) => raw.slice(0, source.start) + embeddedImageDestination(source, data) + raw.slice(source.end),
        };
    }
    if (token?.type !== 'reference_image')
        return;
    const definition = labels.get(normalizeReferenceLabel(token.label + token.backlash.second));
    if (!definition)
        return;
    return {
        src: definition.href,
        attrs: { alt: token.attrs.alt, title: definition.title ?? '' },
        replace: (data: string) => imageToMarkdown({ src: data, alt: token.alt + token.backlash.first, title: definition.title }),
    };
}

/** Captures the pointed occurrence; several images can share a URL or a link definition. */
export function linkedImageAt(muya: Muya, target: Element) {
    const wrapper = target.closest<HTMLElement>('.mu-inline-image');
    const marker = target.matches('img') ? target.previousElementSibling : null;
    const element = wrapper ?? (marker?.matches('.mu-image-marked-text') ? marker : null);
    const paragraph = findContentDOM(element);
    const block = getBlock(paragraph);
    if (!element || !paragraph || !block?.isContent() || !muya.isBlockInDocument(block))
        return;
    const raw = wrapper?.dataset.raw ?? element.textContent ?? '';
    const source = linkedImageSource(raw, muya.editor.inlineEngine.labels);
    if (!source?.src || /^data:/i.test(source.src))
        return;
    const { src, attrs, replace } = source;
    const start = getOffsetOfParagraph(element, paragraph);
    const current = () => !muya.isReadOnly && muya.isBlockInDocument(block) && block.text.startsWith(raw, start);
    return {
        src,
        current,
        resize(width: number, height?: number) {
            replaceImageMarkup(block, start, raw, imageToHtml({ ...attrs, src, width: String(width), ...(height === undefined ? {} : { height: String(height) }) }));
        },
        embed(data: string) {
            replaceImageMarkup(block, start, raw, replace(data));
        },
    };
}
