// @vitest-environment happy-dom

import type Format from '../../../block/base/format';
import type DiagramBlock from '../../../block/extra/diagram';
import type { ISelectionChangePayload } from '../../../selection/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResizeBar } from '..';
import { dropText, getTextDragSource } from '../../../editor/dragDropText';
import { Muya } from '../../../muya';
import { createTextSelectionState } from '../../../selection/state';
import { encodeInlineDrawing } from '../../../utils/diagram/drawingData';
import { getImageInfo } from '../../../utils/image';

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';
const SAMPLE_SCENE = '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}';
const SAMPLE_SCENE_ALT = '{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffeecc"},"files":{}}';
const INLINE_SRC = encodeInlineDrawing(SAMPLE_SCENE);
const INLINE_SRC_ALT = encodeInlineDrawing(SAMPLE_SCENE_ALT);
const INLINE_DRAWING = `![Embedded drawing](${INLINE_SRC})`;
const INLINE_DRAWING_ALT = `![Second drawing](${INLINE_SRC_ALT})`;
const LINKED_DRAWING = '![Linked drawing](sketch.excalidraw)';
const FENCED_DRAWING = `\`\`\`excalidraw\n${SAMPLE_SCENE}\n\`\`\``;

const bootedMuyas: Muya[] = [];
const resizeBars: ImageResizeBar[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    vi.useRealTimers();
    while (resizeBars.length)
        resizeBars.pop()!.destroy();
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    document.querySelectorAll('.mu-transformer').forEach(el => el.remove());
    delete (window as Partial<Window>).MUYA_VERSION;
});

function boot(markdown: string, readOnly = false): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        readOnly,
        resolveImagePreview: (src: string) => {
            if (src === INLINE_SRC || src === INLINE_SRC_ALT || src.endsWith('.excalidraw')) {
                return {
                    key: src,
                    load: async () => PNG_DATA,
                };
            }
            return undefined;
        },
        embeddedDrawing: {
            label: () => 'Embedded drawing',
            preview: async () => PNG_DATA,
            open: () => {},
        },
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedMuyas.push(muya);
    resizeBars.push(new ImageResizeBar(muya));
    return muya;
}

function mouseEvent(type: string, clientX: number, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...init });
    Object.defineProperty(event, 'x', { value: clientX });
    return event;
}

function setBox(element: HTMLElement, width: number, height = 120) {
    element.getBoundingClientRect = () =>
        ({ top: 100, left: 20, right: 20 + width, bottom: 100 + height, width, height, x: 20, y: 100, toJSON: () => '' }) as DOMRect;
}

function mountInlinePreviewImg(wrapper: HTMLElement): HTMLImageElement {
    const container = wrapper.querySelector<HTMLElement>('.mu-image-container')!;
    let img = container.querySelector<HTMLImageElement>('img');
    if (!img) {
        img = document.createElement('img');
        img.src = PNG_DATA;
        container.appendChild(img);
        wrapper.classList.remove('mu-image-loading');
        wrapper.classList.add('mu-image-success');
    }
    return img;
}

function dragHandle(
    img: HTMLImageElement,
    container: HTMLElement,
    { containerWidth, initialWidth, deltaX, side = 'right' }: { containerWidth: number; initialWidth: number; deltaX: number; side?: 'left' | 'right' },
) {
    setBox(container, containerWidth, 200);
    setBox(img, initialWidth, 120);
    img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
    vi.runAllTimers();
    const handle = document.querySelector<HTMLElement>(`.mu-transformer .bar.${side}`);
    expect(handle).not.toBeNull();
    handle!.dispatchEvent(mouseEvent('mousedown', 200));
    document.dispatchEvent(mouseEvent('mousemove', 200 + deltaX));
    const readout = document.querySelector<HTMLElement>('.mu-image-size-readout')?.textContent ?? '';
    document.dispatchEvent(mouseEvent('mouseup', 200 + deltaX));
    return { readout };
}

describe('drawing resize bar and comment persistence', () => {
    it('resizes an inline drawing to pixels and 100% without scrolling or rebuilding DOM', () => {
        vi.useFakeTimers();
        const muya = boot(`# Top Heading\n\n${INLINE_DRAWING}`);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const contentDom = wrapper.closest<HTMLElement>('.mu-paragraph-content')!;
        const img = mountInlinePreviewImg(wrapper);

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        // Drag to non-100% pixel width (300 + 80 = 380 < 700).
        const pxDrag = dragHandle(img, contentDom, { containerWidth: 700, initialWidth: 300, deltaX: 80 });
        expect(pxDrag.readout).not.toContain('100%');
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="380" -->');
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(true);
        expect(wrapper.style.getPropertyValue('--mu-drawing-width')).toBe('380px');
        // In-place update must keep the exact same <img> DOM node.
        expect(wrapper.querySelector('img')).toBe(img);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ docChanged: true, preventScroll: true });

        // Drag to 100% container width (380 + 340 = 720 >= 700).
        const fullDrag = dragHandle(img, contentDom, { containerWidth: 700, initialWidth: 380, deltaX: 340 });
        expect(fullDrag.readout).toContain('100%');
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="100%" -->');
        expect(wrapper.classList.contains('mu-drawing-full-width')).toBe(true);
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(false);
        expect(wrapper.querySelector('img')).toBe(img);
        expect(payloads).toHaveLength(2);
        expect(payloads[1]).toMatchObject({ docChanged: true, preventScroll: true });

        // Undo returns to 380px in place; second undo clears comment; redo restores 380px.
        muya.undo();
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="380" -->');
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(true);
        expect(wrapper.style.getPropertyValue('--mu-drawing-width')).toBe('380px');

        muya.undo();
        expect(muya.getMarkdown()).not.toContain('drawing-layout');
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(false);
        expect(wrapper.classList.contains('mu-drawing-full-width')).toBe(false);

        muya.redo();
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="380" -->');
        expect(wrapper.style.getPropertyValue('--mu-drawing-width')).toBe('380px');

        // Subsequent caret move resumes normal scroll-follow behavior.
        const firstContent = muya.editor.scrollPage!.firstContentInDescendant()!;
        firstContent.setCursor(1, 1);
        expect(payloads.at(-1)?.preventScroll).toBeUndefined();
    });

    it('resizes a fenced excalidraw diagram without rebuilding its preview or scrolling', async () => {
        const muya = boot(`# Top Heading\n\n${FENCED_DRAWING}`);
        const preview = muya.domNode.querySelector<HTMLElement>('.mu-diagram-preview.mu-embedded-drawing')!;
        // Allow async _showDrawing (including decodeImageElement) to mount its <img>.
        await vi.waitFor(() => {
            expect(preview.querySelector<HTMLImageElement>('.mu-embedded-drawing-button > img')).not.toBeNull();
        });
        vi.useFakeTimers();

        const img = preview.querySelector<HTMLImageElement>('.mu-embedded-drawing-button > img')!;
        expect(img).not.toBeNull();

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        // Drag left handle outward by -100px (width grows from 300 -> 400).
        dragHandle(img, preview, { containerWidth: 800, initialWidth: 300, deltaX: -100, side: 'left' });
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="400" -->');
        expect(preview.classList.contains('mu-drawing-sized')).toBe(true);
        expect(preview.style.getPropertyValue('--mu-drawing-width')).toBe('400px');
        expect(preview.querySelector('img')).toBe(img);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ docChanged: true, preventScroll: true });

        // Drag to 100%.
        dragHandle(img, preview, { containerWidth: 800, initialWidth: 400, deltaX: 450 });
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="100%" -->');
        expect(preview.classList.contains('mu-drawing-full-width')).toBe(true);
        expect(payloads).toHaveLength(2);
        expect(payloads[1]).toMatchObject({ docChanged: true, preventScroll: true });

        // Undo reverts to 400px in place without destroying the <img>.
        muya.undo();
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="400" -->');
        expect(preview.querySelector('img')).toBe(img);
    });

    it('resizes a linked .excalidraw drawing with HTML comment instead of rewriting to <img>', () => {
        vi.useFakeTimers();
        const muya = boot(`# Top Heading\n\n${LINKED_DRAWING}`);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-linked-drawing')!;
        expect(wrapper).not.toBeNull();
        const contentDom = wrapper.closest<HTMLElement>('.mu-paragraph-content')!;
        const img = mountInlinePreviewImg(wrapper);

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        dragHandle(img, contentDom, { containerWidth: 640, initialWidth: 260, deltaX: 100 });
        const md = muya.getMarkdown();
        expect(md).toContain('<!-- drawing-layout: width="360" -->');
        expect(md).toContain(LINKED_DRAWING);
        expect(md).not.toContain('<img');
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ docChanged: true, preventScroll: true });
    });

    it('tracks per-drawing ordinals when resizing the second drawing on the same row', () => {
        vi.useFakeTimers();
        const muya = boot(`${INLINE_DRAWING} ${INLINE_DRAWING}`);
        const wrappers = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-inline-drawing')];
        expect(wrappers).toHaveLength(2);
        const contentDom = wrappers[0].closest<HTMLElement>('.mu-paragraph-content')!;
        const secondImg = mountInlinePreviewImg(wrappers[1]);

        dragHandle(secondImg, contentDom, { containerWidth: 800, initialWidth: 200, deltaX: 120 });
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: widths="2:320" -->');
        expect(wrappers[0].classList.contains('mu-drawing-sized')).toBe(false);
        expect(wrappers[1].classList.contains('mu-drawing-sized')).toBe(true);
        expect(wrappers[1].style.getPropertyValue('--mu-drawing-width')).toBe('320px');
    });

    it('skips emitting selection-change when releasing at the same 100% width', () => {
        vi.useFakeTimers();
        const muya = boot(`<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING}`);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const contentDom = wrapper.closest<HTMLElement>('.mu-paragraph-content')!;
        const img = mountInlinePreviewImg(wrapper);

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        dragHandle(img, contentDom, { containerWidth: 700, initialWidth: 700, deltaX: 50 });
        expect(payloads).toHaveLength(0);
    });

    it('renders remembered drawing size in read-only mode without showing resize bars on hover', () => {
        vi.useFakeTimers();
        const muya = boot(`<!-- drawing-layout: width="440" -->\n\n${INLINE_DRAWING}`, true);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const img = mountInlinePreviewImg(wrapper);

        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(true);
        expect(wrapper.style.getPropertyValue('--mu-drawing-width')).toBe('440px');

        setBox(img, 440, 120);
        img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
        vi.runAllTimers();
        expect(document.querySelectorAll('.mu-transformer .bar')).toHaveLength(0);
    });

    it('preserves remembered width when converting a legacy fenced drawing to inline', () => {
        const muya = boot(`<!-- drawing-layout: width="512" -->\n\n${FENCED_DRAWING}`);
        const diagram = muya.editor.scrollPage!.firstChild as DiagramBlock;
        diagram.moveCaretBesideDrawing(false);
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="512" -->');
        expect(muya.getMarkdown()).toContain(INLINE_SRC);
    });

    it('restores preview width and commits nothing when a drag is cancelled mid-flight', () => {
        vi.useFakeTimers();
        const muya = boot(`<!-- drawing-layout: width="300" -->\n\n${INLINE_DRAWING}`);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const contentDom = wrapper.closest<HTMLElement>('.mu-paragraph-content')!;
        const img = mountInlinePreviewImg(wrapper);
        const bar = resizeBars.at(-1)!;

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        setBox(contentDom, 700, 200);
        setBox(img, 300, 120);
        img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
        vi.runAllTimers();
        const handle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
        handle.dispatchEvent(mouseEvent('mousedown', 200));
        document.dispatchEvent(mouseEvent('mousemove', 650));
        expect(wrapper.classList.contains('mu-drawing-full-width')).toBe(true);

        bar.hide();
        expect(wrapper.classList.contains('mu-drawing-full-width')).toBe(false);
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(true);
        expect(wrapper.style.getPropertyValue('--mu-drawing-width')).toBe('300px');
        expect(payloads).toHaveLength(0);
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: width="300" -->');
    });

    it('supports resizing and undo/redo for drawings nested inside a blockquote', () => {
        vi.useFakeTimers();
        const muya = boot(`> ${INLINE_DRAWING}`);
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const contentDom = wrapper.closest<HTMLElement>('.mu-paragraph-content')!;
        const img = mountInlinePreviewImg(wrapper);

        dragHandle(img, contentDom, { containerWidth: 600, initialWidth: 250, deltaX: 150 });
        expect(muya.getMarkdown()).toContain('> <!-- drawing-layout: width="400" -->');

        muya.undo();
        expect(muya.getMarkdown()).not.toContain('drawing-layout');
        expect(wrapper.classList.contains('mu-drawing-sized')).toBe(false);

        muya.redo();
        expect(muya.getMarkdown()).toContain('> <!-- drawing-layout: width="400" -->');
        const restored = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        expect(restored.style.getPropertyValue('--mu-drawing-width')).toBe('400px');
    });

    it('preserves remembered widths when splitting a paragraph with Enter', () => {
        const muya = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        const splitOffset = INLINE_DRAWING.length;
        content.setCursor(splitOffset, splitOffset, true);
        content.enterHandler(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        muya.flush();

        const md = muya.getMarkdown();
        expect(md).toContain(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}`);
        expect(md).toContain(`<!-- drawing-layout: width="100%" -->\n\n ${INLINE_DRAWING}`);
    });

    it('remaps surviving drawing width by source when the earlier drawing is deleted', () => {
        const muya = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING_ALT}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        content.text = INLINE_DRAWING_ALT;
        content.update();
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING_ALT}`);
        const surviving = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        expect(surviving.classList.contains('mu-drawing-full-width')).toBe(true);
        expect(surviving.classList.contains('mu-drawing-sized')).toBe(false);

        muya.undo();
        expect(muya.getMarkdown()).toContain('<!-- drawing-layout: widths="1:320,2:100%" -->');
    });

    it('preserves both drawing widths when merging paragraphs with Backspace', () => {
        const markdown = [
            '<!-- drawing-layout: width="320" -->',
            '',
            INLINE_DRAWING,
            '',
            '<!-- drawing-layout: width="100%" -->',
            '',
            INLINE_DRAWING_ALT,
        ].join('\n');
        const muya = boot(markdown);
        const secondContent = muya.editor.scrollPage!.lastContentInDescendant()!;
        secondContent.setCursor(0, 0, true);
        secondContent.backspaceHandler(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING}${INLINE_DRAWING_ALT}`);
        const drawings = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-inline-drawing')];
        expect(drawings).toHaveLength(2);
        expect(drawings[0].style.getPropertyValue('--mu-drawing-width')).toBe('320px');
        expect(drawings[1].classList.contains('mu-drawing-full-width')).toBe(true);

        muya.undo();
        const restored = muya.getMarkdown();
        expect(restored).toContain(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}`);
        expect(restored).toContain(`<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING_ALT}`);
    });

    it('preserves both drawing widths when merging paragraphs with Delete', () => {
        const markdown = [
            '<!-- drawing-layout: width="320" -->',
            '',
            INLINE_DRAWING,
            '',
            '<!-- drawing-layout: width="100%" -->',
            '',
            INLINE_DRAWING_ALT,
        ].join('\n');
        const muya = boot(markdown);
        const firstContent = muya.editor.scrollPage!.firstContentInDescendant()!;
        firstContent.setCursor(firstContent.text.length, firstContent.text.length, true);
        firstContent.deleteHandler(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING}${INLINE_DRAWING_ALT}`);
    });

    it('preserves drawing widths when pasting a sized drawing inline into a sized paragraph', async () => {
        const muya = boot(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        content.setCursor(content.text.length, content.text.length, true);
        const clipboardText = `<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING_ALT}`;
        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clipboardData: {
                getData: (type: string) => (type === 'text/plain' ? clipboardText : ''),
                files: [],
                items: [],
            },
        } as unknown as ClipboardEvent;
        await muya.editor.clipboard.pasteHandler(event);
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING}${INLINE_DRAWING_ALT}`);
    });

    it('keeps the surviving second drawing width when deleting the first of two identical-src drawings via deleteImage without preventScroll', () => {
        const muya = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant() as Format;
        const firstWrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        const preventScrollFlags: Array<boolean | undefined> = [];
        muya.on('selection-change', (payload: ISelectionChangePayload) => {
            preventScrollFlags.push(payload.preventScroll);
        });

        content.deleteImage(getImageInfo(firstWrapper));
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: width="100%" -->\n\n ${INLINE_DRAWING}`);
        const surviving = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;
        expect(surviving.classList.contains('mu-drawing-full-width')).toBe(true);
        expect(surviving.classList.contains('mu-drawing-sized')).toBe(false);
        expect(preventScrollFlags.every(flag => flag !== true)).toBe(true);

        muya.undo();
        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
    });

    it('keeps the surviving second drawing width when deleting the first of two identical-src drawings in text via unchanged diff spans', () => {
        const muya = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\nBefore ${INLINE_DRAWING} middle ${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        content.text = `Before  middle ${INLINE_DRAWING}`;
        content.update();
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: width="100%" -->\n\nBefore  middle ${INLINE_DRAWING}`);
        muya.undo();
        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\nBefore ${INLINE_DRAWING} middle ${INLINE_DRAWING}`);
    });

    it('preserves surviving drawing width on same-block cut of the first identical-src drawing', () => {
        const muya = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        content.setCursor(0, INLINE_DRAWING.length + 1, true);
        muya.editor.clipboard.cutHandler();
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING}`);
        muya.undo();
        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
    });

    it('preserves head and tail drawing widths across a cross-block cut', () => {
        const markdown = [
            '<!-- drawing-layout: width="320" -->',
            '',
            `${INLINE_DRAWING} cut-start`,
            '',
            '<!-- drawing-layout: width="400" -->',
            '',
            INLINE_DRAWING_ALT,
            '',
            '<!-- drawing-layout: width="100%" -->',
            '',
            `cut-end ${INLINE_DRAWING}`,
        ].join('\n');
        const muya = boot(markdown);
        const startBlock = muya.editor.scrollPage!.firstContentInDescendant()!;
        const endBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
        muya.editor.selection.setSelection(createTextSelectionState(
            { block: startBlock, offset: INLINE_DRAWING.length + 1, path: startBlock.path },
            { block: endBlock, offset: 'cut-end '.length, path: endBlock.path },
        ));
        muya.editor.clipboard.cutHandler();
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        expect(muya.getMarkdown()).not.toContain('400');

        muya.undo();
        const restored = muya.getMarkdown();
        expect(restored).toContain(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING} cut-start`);
        expect(restored).toContain(`<!-- drawing-layout: width="400" -->\n\n${INLINE_DRAWING_ALT}`);
        expect(restored).toContain(`<!-- drawing-layout: width="100%" -->\n\ncut-end ${INLINE_DRAWING}`);
    });

    it('preserves drawing widths on same-paragraph and cross-paragraph text drag-drop', () => {
        // Same-paragraph move swapping two identical-src drawings
        const samePara = boot(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        const content = samePara.editor.scrollPage!.firstContentInDescendant()!;
        content.setCursor(0, INLINE_DRAWING.length, true);
        const sameSource = getTextDragSource(samePara)!;
        dropText(samePara, sameSource, { block: content, offset: content.text.length, path: content.path }, false);
        samePara.flush();

        expect(samePara.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:100%,2:320" -->\n\n ${INLINE_DRAWING}${INLINE_DRAWING}`);
        samePara.undo();
        expect(samePara.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);

        // Cross-paragraph move
        const crossMove = boot(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}\n\n<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING_ALT}`);
        const firstMove = crossMove.editor.scrollPage!.firstContentInDescendant()!;
        const secondMove = crossMove.editor.scrollPage!.lastContentInDescendant()!;
        firstMove.setCursor(0, INLINE_DRAWING.length, true);
        const moveSource = getTextDragSource(crossMove)!;
        dropText(crossMove, moveSource, { block: secondMove, offset: 0, path: secondMove.path }, false);
        crossMove.flush();

        expect(crossMove.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING}${INLINE_DRAWING_ALT}`);

        // Cross-paragraph copy
        const crossCopy = boot(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}\n\n<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING_ALT}`);
        const firstCopy = crossCopy.editor.scrollPage!.firstContentInDescendant()!;
        const secondCopy = crossCopy.editor.scrollPage!.lastContentInDescendant()!;
        firstCopy.setCursor(0, INLINE_DRAWING.length, true);
        const copySource = getTextDragSource(crossCopy)!;
        dropText(crossCopy, copySource, { block: secondCopy, offset: secondCopy.text.length, path: secondCopy.path }, true);
        crossCopy.flush();

        const copyMd = crossCopy.getMarkdown();
        expect(copyMd).toContain(`<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}`);
        expect(copyMd).toContain(`<!-- drawing-layout: widths="1:100%,2:320" -->\n\n${INLINE_DRAWING_ALT}${INLINE_DRAWING}`);
    });

    it('preserves drawing widths when pasting a list item with a sized drawing into a list item', async () => {
        const muya = boot(`- <!-- drawing-layout: width="320" -->\n\n  ${INLINE_DRAWING}`);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        content.setCursor(content.text.length, content.text.length, true);
        const clipboardText = `- <!-- drawing-layout: width="100%" -->\n\n  ${INLINE_DRAWING_ALT}`;
        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clipboardData: {
                getData: (type: string) => (type === 'text/plain' ? clipboardText : ''),
                files: [],
                items: [],
            },
        } as unknown as ClipboardEvent;
        await muya.editor.clipboard.pasteHandler(event);
        muya.flush();

        expect(muya.getMarkdown()).toContain(`<!-- drawing-layout: widths="1:320,2:100%" -->`);
        expect(muya.getMarkdown()).toContain(`${INLINE_DRAWING}${INLINE_DRAWING_ALT}`);
    });

    it('drops drawing-layout comment cleanly when merging a sized drawing paragraph into a heading', () => {
        const muya = boot(`# Heading\n\n<!-- drawing-layout: width="320" -->\n\n${INLINE_DRAWING}`);
        const paragraphContent = muya.editor.scrollPage!.lastContentInDescendant()!;
        paragraphContent.setCursor(0, 0, true);
        paragraphContent.backspaceHandler(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        muya.flush();

        const md = muya.getMarkdown();
        expect(md).toContain(`# Heading${INLINE_DRAWING}`);
        expect(md).not.toContain('drawing-layout');
    });
});
