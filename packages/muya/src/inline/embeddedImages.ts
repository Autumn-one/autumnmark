import type Content from '../block/base/content';
import type { IEmbeddedImage } from '../utils/embeddedImage';
import { getOffsetOfParagraph } from '../selection/dom';
import { embeddedImageSource, findEmbeddedImages, replaceEmbeddedImage } from '../utils/embeddedImage';
import { isImageToken } from '../utils/image';
import { parseInline } from './parser/lexer';

/** Only the display copy goes through the inline lexer and syntax highlighter. */
export function projectEmbeddedImages(block: Content) {
    if (!block.muya.options.editEmbeddedImage)
        return;
    const original = block.text;
    const images = findEmbeddedImages(original);
    if (!images.length)
        return;
    let prefix = '\uE000';
    while (original.includes(prefix)) prefix += '\uE000';
    const parts: string[] = [];
    // Private-use digits keep syntax highlighters from splitting a marker at a number.
    const markers = images.map((_, index) => {
        const digits = Array.from(String(index), digit => String.fromCharCode(0xE010 + Number(digit)));
        return `${prefix}${digits.join('')}\uE001`;
    });
    const byMarker = new Map(markers.map((marker, index) => [marker, images[index]]));
    let pos = 0;
    for (const [i, image] of images.entries()) {
        parts.push(original.slice(pos, image.start), markers[i]);
        pos = image.end;
    }
    parts.push(original.slice(pos));

    function offset(position: number) {
        let delta = 0;
        for (const [i, image] of images.entries()) {
            if (position <= image.start)
                break;
            if (position < image.end)
                return image.start - delta;
            delta += image.end - image.start - markers[i].length;
        }
        return position - delta;
    }

    function atom(image: IEmbeddedImage, preview: boolean) {
        const node = document.createElement('span');
        node.className = 'mu-embedded-image';
        node.contentEditable = 'false';
        const raw = original.slice(image.start, image.end);
        embeddedImageSource.set(node, raw);
        node.textContent = image.label;
        if (preview && image.preview) {
            const img = document.createElement('img');
            img.src = image.src;
            const token = parseInline(raw.replace(image.src, 'image.png'))[0];
            if (isImageToken(token)) {
                for (const attr of ['alt', 'title', 'width', 'height'] as const) {
                    const value = token.attrs[attr];
                    if (value)
                        img.setAttribute(attr, value);
                }
            }
            img.draggable = false;
            node.prepend(img);
        }
        if (!block.muya.isReadOnly) {
            node.tabIndex = 0;
            node.setAttribute('role', 'button');
            const edit = (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                const start = getOffsetOfParagraph(node, block.domNode!);
                block.muya.options.editEmbeddedImage?.({
                    src: image.src,
                    apply: (src) => {
                        if (block.muya.isReadOnly || !block.muya.isBlockInDocument(block) || block.text.slice(start, start + raw.length) !== raw)
                            return;
                        const replacement = replaceEmbeddedImage(raw, image, src);
                        block.muya.transact(() => {
                            block.text = block.text.slice(0, start) + replacement + block.text.slice(start + raw.length);
                            const caret = start + replacement.length;
                            block.setCursor(caret, caret, true);
                        });
                    },
                });
            };
            node.onclick = edit;
            node.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ')
                    edit(event);
            };
        }
        return node;
    }

    function mount(root: HTMLElement, preview: boolean) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node instanceof Text && node.data.includes(prefix))
                nodes.push(node);
        }
        const pattern = new RegExp(`${prefix}[\uE010-\uE019]+\uE001`, 'g');
        for (const node of nodes) {
            const fragment = document.createDocumentFragment();
            let pos = 0;
            for (const match of node.data.matchAll(pattern)) {
                const image = byMarker.get(match[0]);
                if (!image)
                    continue;
                fragment.append(node.data.slice(pos, match.index), atom(image, preview));
                pos = match.index + match[0].length;
            }
            fragment.append(node.data.slice(pos));
            node.replaceWith(fragment);
        }
    }

    return { text: parts.join(''), offset, mount };
}
