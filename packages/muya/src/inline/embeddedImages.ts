import type Content from '../block/base/content';
import type { IEmbeddedImage } from '../utils/embeddedImage';
import { getOffsetOfParagraph } from '../selection/dom';
import { bindEmbeddedImageEvents, embeddedImageSource, embeddedImageWidths, findEmbeddedMedia, replaceEmbeddedImage } from '../utils/embeddedImage';
import { resolveVideoSource } from '../utils/fileUrl';
import { imageToHtml, isImageToken, replaceImageMarkup } from '../utils/image';
import { embeddedPictureSize } from './imageDimensions';
import { parseInline } from './parser/lexer';

function stopEditorEvent(event: Event) {
    event.stopPropagation();
}

export function mountVideoPlayer(node: HTMLElement, player: HTMLVideoElement, label: string, edit: (event: MouseEvent) => void) {
    node.classList.add('mu-embedded-image', 'mu-embedded-video');
    node.contentEditable = 'false';
    player.controls = true;
    player.preload = 'metadata';
    player.setAttribute('aria-label', label);
    player.oncontextmenu = player.onclick = edit;
    // Chromium's seek slider emits input through the video host. A text edit would remount it mid-seek.
    player.oninput = stopEditorEvent;
    player.onmousedown = player.onkeydown = player.onkeyup = stopEditorEvent;

    const caption = node.ownerDocument.createElement('button');
    caption.type = 'button';
    caption.textContent = label;
    caption.onkeydown = caption.onkeyup = stopEditorEvent;
    bindEmbeddedImageEvents(caption, edit);
    node.replaceChildren(player, caption);
}

export function openEmbeddedMedia(block: Content, image: IEmbeddedImage, raw: string, name: string, start: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const matches = (expected: string) => {
        const previous = replaceEmbeddedImage(raw, image, expected);
        return block.muya.isBlockInDocument(block) && block.text.startsWith(previous, start);
    };
    block.muya.options.editEmbeddedImage?.({
        src: image.src,
        kind: image.kind,
        name,
        readOnly: block.muya.isReadOnly,
        size: embeddedPictureSize(raw, image, (markup, expected) => {
            replaceImageMarkup(block, start, replaceEmbeddedImage(raw, image, expected), markup);
        }),
        matches,
        undo: () => block.muya.undo(),
        apply: (src, expected = image.src) => {
            if (block.muya.isReadOnly || !matches(expected))
                return;
            const previous = replaceEmbeddedImage(raw, image, expected);
            const replacement = replaceEmbeddedImage(raw, image, src);
            block.muya.editor.history.cutoff();
            block.muya.transact(() => {
                block.text = block.text.slice(0, start) + replacement + block.text.slice(start + previous.length);
                const caret = start + replacement.length;
                block.setCursor(caret, caret, true);
            });
            block.muya.editor.history.cutoff();
        },
    }, event instanceof MouseEvent ? event : undefined);
}

function imagePreview(block: Content, node: HTMLElement, image: IEmbeddedImage, raw: string) {
    const img = document.createElement('img');
    img.src = image.src;
    const token = parseInline(replaceEmbeddedImage(raw, image, 'image.png'))[0];
    node.classList.add('mu-embedded-picture');
    if (isImageToken(token)) {
        const align = token.attrs['data-align'];
        if (align && ['left', 'center', 'right', 'inline'].includes(align))
            node.classList.add(align);
        embeddedImageWidths.set(img, (width, height) => {
            if (!node.isConnected)
                return;
            const start = getOffsetOfParagraph(node, block.domNode!);
            const resized = imageToHtml({ ...token.attrs, src: image.src, width: String(width), ...(height === undefined ? {} : { height: String(height) }) });
            replaceImageMarkup(block, start, raw, resized);
        });
        for (const attr of ['alt', 'title', 'width', 'height'] as const) {
            const value = token.attrs[attr];
            if (value)
                img.setAttribute(attr, value);
        }
    }
    return img;
}

/** Only the display copy goes through the inline lexer and syntax highlighter. */
export function projectEmbeddedImages(block: Content) {
    if (!block.muya.options.editEmbeddedImage)
        return;
    const original = block.text;
    const images = findEmbeddedMedia(original);
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
        let name = /^!\[([^\]]*)\]/.exec(raw)?.[1] ?? '';
        const edit = (event: Event) => {
            const start = getOffsetOfParagraph(node, block.domNode!);
            openEmbeddedMedia(block, image, raw, name, start, event);
        };
        if (image.kind === 'video') {
            node.classList.add('mu-embedded-video');
            name = image.name ?? '';
            node.textContent = name || image.label;
            if (preview && image.preview) {
                const player = document.createElement('video');
                player.src = block.muya.options.videoAttachments?.playback(image.src) ?? resolveVideoSource(image.src);
                const token = parseInline(replaceEmbeddedImage(raw, image, 'video.webm'))[0];
                if (token?.type === 'html_tag' && token.tag === 'video') {
                    for (const dimension of ['width', 'height'] as const) {
                        const value = token.attrs[dimension];
                        if (value)
                            player.setAttribute(dimension, value);
                    }
                }
                mountVideoPlayer(node, player, name || image.label, edit);
                return node;
            }
        }
        else if (preview && image.preview) {
            const img = imagePreview(block, node, image, raw);
            name = img.alt || name;
            img.draggable = false;
            const surface = document.createElement('span');
            surface.className = 'mu-embedded-picture-surface';
            const badge = document.createElement('span');
            badge.className = 'mu-embedded-picture-badge mu-copy-remove mu-output-remove';
            badge.title = block.muya.i18n.t('Embedded in this document');
            badge.setAttribute('aria-hidden', 'true');
            surface.append(img, badge);
            node.replaceChildren(surface);
            node.setAttribute('aria-label', [name || block.muya.i18n.t('Edit Image'), badge.title].join(', '));
        }
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        bindEmbeddedImageEvents(node, edit);
        node.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ')
                edit(event);
        };
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

    function isImageMarker(raw: string) {
        const media = byMarker.get(raw);
        return media?.preview === true && media.kind !== 'video';
    }

    return { text: parts.join(''), offset, mount, isImageMarker };
}
