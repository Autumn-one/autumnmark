// @vitest-environment happy-dom

import type { ISelectionChangePayload } from '../../../selection/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResizeBar } from '..';
import { CLASS_NAMES } from '../../../config';
import { embeddedPictureSize } from '../../../inline/imageDimensions';
import { Muya } from '../../../muya';
import { SelectionType } from '../../../selection/types';
import { findEmbeddedImages } from '../../../utils/embeddedImage';

const EMBEDDED_SRC = 'data:image/png;base64,iVBORw0KGgo=';
const LINKED_SRC = 'https://example.com/pic.png';

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

function boot(markdown: string, withEmbedded = true): { muya: Muya; bar: ImageResizeBar } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        ...(withEmbedded ? { editEmbeddedImage: () => {} } : {}),
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    const bar = new ImageResizeBar(muya);
    bootedMuyas.push(muya);
    resizeBars.push(bar);
    return { muya, bar };
}

function mouseEvent(type: string, clientX: number, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...init });
    Object.defineProperty(event, 'x', { value: clientX });
    return event;
}

function setBox(element: HTMLElement, width: number, height = 100) {
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
    element.getBoundingClientRect = () =>
        ({ top: 100, left: 20, right: 20 + width, bottom: 100 + height, width, height, x: 20, y: 100, toJSON: () => '' }) as DOMRect;
}

function attachLoadedInlineImage(muya: Muya, src: string, attrs: { width?: string; height?: string } = {}): HTMLImageElement {
    const wrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
    const container = wrapper.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!;
    const img = document.createElement('img');
    img.setAttribute('src', src);
    if (attrs.width)
        img.setAttribute('width', attrs.width);
    if (attrs.height)
        img.setAttribute('height', attrs.height);
    container.appendChild(img);
    wrapper.classList.remove(CLASS_NAMES.MU_IMAGE_LOADING);
    wrapper.classList.add(CLASS_NAMES.MU_IMAGE_SUCCESS);
    return img;
}

function dragRightHandle(img: HTMLImageElement, initialWidth: number, deltaX: number, onMove?: () => void) {
    setBox(img, initialWidth);
    img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
    vi.runAllTimers();
    const handle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
    expect(handle).not.toBeNull();
    handle.dispatchEvent(mouseEvent('mousedown', 100));
    document.dispatchEvent(mouseEvent('mousemove', 100 + deltaX));
    onMove?.();
    document.dispatchEvent(mouseEvent('mouseup', 100 + deltaX));
}

describe('full-width (100%) image resize across image paths', () => {
    it('snaps embedded images to 100%, removes height, and shrinks back to pixels when dragged smaller', () => {
        vi.useFakeTimers();
        const { muya } = boot(`# Top\n\n<img title="" src="${EMBEDDED_SRC}" alt="pic" width="240" height="160" />`);
        const content = muya.domNode.querySelectorAll<HTMLElement>('.mu-paragraph-content')[0]!;
        setBox(content, 600);
        const img = content.querySelector<HTMLImageElement>('.mu-embedded-picture img')!;
        const picture = content.querySelector<HTMLElement>('.mu-embedded-picture')!;

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        let readoutDuringDrag = '';
        let fullWidthClassDuringDrag = false;
        let heightAttrDuringDrag: string | null = 'unset';
        dragRightHandle(img, 240, 360, () => {
            readoutDuringDrag = document.querySelector('.mu-image-size-readout')?.textContent ?? '';
            fullWidthClassDuringDrag = picture.classList.contains('mu-image-full-width');
            heightAttrDuringDrag = img.getAttribute('height');
        });

        expect(fullWidthClassDuringDrag).toBe(true);
        expect(readoutDuringDrag).toContain('100%');
        expect(heightAttrDuringDrag).toBeNull();
        expect(muya.getMarkdown()).toContain('width="100%"');
        expect(muya.getMarkdown()).not.toContain('height=');
        expect(muya.domNode.querySelector('.mu-embedded-picture')?.classList.contains('mu-image-full-width')).toBe(true);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ docChanged: true, preventScroll: true });

        // Drag back below container width to leave 100% mode and persist pixel width.
        const fullContent = muya.domNode.querySelectorAll<HTMLElement>('.mu-paragraph-content')[0]!;
        setBox(fullContent, 600);
        const fullImg = fullContent.querySelector<HTMLImageElement>('.mu-embedded-picture img')!;
        dragRightHandle(fullImg, 600, -200);

        expect(muya.getMarkdown()).toContain('width="400"');
        expect(muya.getMarkdown()).not.toContain('width="100%"');
        expect(muya.domNode.querySelector('.mu-embedded-picture')?.classList.contains('mu-image-full-width')).toBe(false);
    });

    it('snaps hovered linked images to 100% and strips previous height', () => {
        vi.useFakeTimers();
        const { muya } = boot(`<img title="" src="${LINKED_SRC}" alt="pic" width="240" height="160" />`, false);
        const content = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        setBox(content, 600);
        const img = attachLoadedInlineImage(muya, LINKED_SRC, { width: '240', height: '160' });

        dragRightHandle(img, 240, 360);

        expect(muya.getMarkdown()).toContain('width="100%"');
        expect(muya.getMarkdown()).not.toContain('height=');
        expect(muya.domNode.querySelector('.mu-inline-image')?.classList.contains('mu-image-full-width')).toBe(true);
    });

    it('snaps clicked/selected images to 100%, removes height, and emits preventScroll: true', () => {
        vi.useFakeTimers();
        const { muya } = boot(`# Top\n\n<img title="" src="${LINKED_SRC}" alt="pic" width="240" height="160" />`, false);
        const content = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        setBox(content, 600);
        const img = attachLoadedInlineImage(muya, LINKED_SRC, { width: '240', height: '160' });
        const wrapper = content.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        setBox(wrapper, 240);
        setBox(img, 240);

        const paragraph = muya.editor.scrollPage!.children.tail!.firstContentInDescendant()!;
        muya.editor.selection.setSelection({
            kind: SelectionType.IMAGE,
            path: paragraph.path,
            range: { start: 0, end: paragraph.text.length },
            raw: paragraph.text,
        });
        vi.runAllTimers();

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        const handle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
        expect(handle).not.toBeNull();
        handle.dispatchEvent(mouseEvent('mousedown', 100));
        document.dispatchEvent(mouseEvent('mousemove', 460));
        document.dispatchEvent(mouseEvent('mouseup', 460));
        muya.flush();

        expect(muya.getMarkdown()).toContain('width="100%"');
        expect(muya.getMarkdown()).not.toContain('height=');
        expect(payloads.length).toBeGreaterThanOrEqual(1);
        expect(payloads.at(-1)).toMatchObject({ docChanged: true, preventScroll: true });

        // Releasing an already-100% selected image at 100% must not re-dirty the document.
        const countAfterCommit = payloads.length;
        const updatedContent = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        setBox(updatedContent, 600);
        const updatedImg = attachLoadedInlineImage(muya, LINKED_SRC, { width: '100%' });
        const updatedWrapper = updatedContent.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        setBox(updatedWrapper, 600);
        setBox(updatedImg, 600);
        const updatedParagraph = muya.editor.scrollPage!.children.tail!.firstContentInDescendant()!;
        muya.editor.selection.setSelection({
            kind: SelectionType.IMAGE,
            path: updatedParagraph.path,
            range: { start: 0, end: updatedParagraph.text.length },
            raw: updatedParagraph.text,
        });
        vi.runAllTimers();
        const beforeNoop = payloads.length;
        expect(beforeNoop).toBeGreaterThanOrEqual(countAfterCommit);

        const secondHandle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
        secondHandle.dispatchEvent(mouseEvent('mousedown', 100));
        document.dispatchEvent(mouseEvent('mousemove', 110));
        document.dispatchEvent(mouseEvent('mouseup', 110));
        muya.flush();
        expect(payloads.length).toBe(beforeNoop);
    });

    it('previews and persists 100% width for reference images', () => {
        vi.useFakeTimers();
        const { muya } = boot(`![pic][ref]\n\n[ref]: ${LINKED_SRC}`, false);
        const content = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        setBox(content, 500);
        const marker = content.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_MARKED_TEXT}`)!;
        const img = document.createElement('img');
        img.setAttribute('src', LINKED_SRC);
        marker.after(img);

        let hadFullWidthClassOnImg = false;
        dragRightHandle(img, 200, 300, () => {
            hadFullWidthClassOnImg = img.classList.contains('mu-image-full-width');
        });

        expect(hadFullWidthClassOnImg).toBe(true);
        expect(muya.getMarkdown()).toContain('width="100%"');
        expect(muya.domNode.querySelector('.mu-inline-image')?.classList.contains('mu-image-full-width')).toBe(true);
    });

    it('restores original preview attributes and class when cancelled mid-drag', () => {
        vi.useFakeTimers();
        const { muya, bar } = boot(`<img title="" src="${EMBEDDED_SRC}" alt="pic" width="240" height="160" />`);
        const content = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        setBox(content, 600);
        const picture = content.querySelector<HTMLElement>('.mu-embedded-picture')!;
        const img = picture.querySelector<HTMLImageElement>('img')!;

        setBox(img, 240);
        img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
        vi.runAllTimers();
        const handle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
        handle.dispatchEvent(mouseEvent('mousedown', 100));
        document.dispatchEvent(mouseEvent('mousemove', 460));

        expect(picture.classList.contains('mu-image-full-width')).toBe(true);
        expect(img.getAttribute('width')).toBe('100%');
        expect(img.hasAttribute('height')).toBe(false);

        bar.hide();

        expect(picture.classList.contains('mu-image-full-width')).toBe(false);
        expect(img.getAttribute('width')).toBe('240');
        expect(img.getAttribute('height')).toBe('160');
        expect(muya.getMarkdown()).toContain('width="240"');
    });
});

describe('table cell 100% snap predicate', () => {
    it('follows the four-row table column rule for 100% snapping', () => {
        vi.useFakeTimers();
        const { muya } = boot(
            `| Col A | Col B |\n| --- | --- |\n| ![pic](${EMBEDDED_SRC}) | text |`,
        );

        const dragCellImage = (
            configureTable: (table: HTMLElement, cellA: HTMLElement, cellB: HTMLElement) => void,
        ) => {
            const table = muya.domNode.querySelector<HTMLElement>('.mu-table-inner')!;
            const cells = muya.domNode.querySelectorAll<HTMLElement>('.mu-table-inner tr:nth-child(2) .mu-table-cell');
            const cellA = cells[0]!;
            const cellB = cells[1]!;
            for (const c of [cellA, cellB]) {
                c.classList.remove('mu-table-cell-fill');
                c.style.removeProperty('--mu-cell-width');
            }
            configureTable(table, cellA, cellB);
            const content = cellA.querySelector<HTMLElement>('.mu-table-cell-content')!;
            setBox(content, 300);
            const img = content.querySelector<HTMLImageElement>('.mu-embedded-picture img')!;
            dragRightHandle(img, 180, 120);
            return muya.getMarkdown();
        };

        // 1. Default table without any column widths -> allows 100%.
        expect(dragCellImage(() => {})).toContain('width="100%"');

        // Reset to pixel width before next case.
        muya.setContent(`| Col A | Col B |\n| --- | --- |\n| ![pic](${EMBEDDED_SRC}) | text |`);

        // 2. Column with explicit --mu-cell-width -> allows 100%.
        expect(dragCellImage((_t, cellA) => {
            cellA.style.setProperty('--mu-cell-width', '300px');
        })).toContain('width="100%"');

        muya.setContent(`| Col A | Col B |\n| --- | --- |\n| ![pic](${EMBEDDED_SRC}) | text |`);

        // 3. Column with .mu-table-cell-fill -> allows 100%.
        expect(dragCellImage((_t, cellA) => {
            cellA.classList.add('mu-table-cell-fill');
        })).toContain('width="100%"');

        muya.setContent(`| Col A | Col B |\n| --- | --- |\n| ![pic](${EMBEDDED_SRC}) | text |`);

        // 4a. Companion column in a table with a pixel column -> skips 100% snap.
        const pixelSiblingMd = dragCellImage((_t, _cellA, cellB) => {
            cellB.style.setProperty('--mu-cell-width', '200px');
        });
        expect(pixelSiblingMd).toContain('width="300"');
        expect(pixelSiblingMd).not.toContain('width="100%"');

        muya.setContent(`| Col A | Col B |\n| --- | --- |\n| ![pic](${EMBEDDED_SRC}) | text |`);

        // 4b. Companion 1px column beside a fill column -> skips 100% snap.
        const fillSiblingMd = dragCellImage((_t, _cellA, cellB) => {
            cellB.classList.add('mu-table-cell-fill');
        });
        expect(fillSiblingMd).toContain('width="300"');
        expect(fillSiblingMd).not.toContain('width="100%"');
    });
});

describe('embeddedPictureSize for width="100%"', () => {
    it('recognizes width="100%" and clears it on auto-size apply', () => {
        const raw = `<img title="" src="${EMBEDDED_SRC}" alt="pic" width="100%" />`;
        const [image] = findEmbeddedImages(raw);
        let committed = '';
        const size = embeddedPictureSize(raw, image!, (markup) => {
            committed = markup;
        });

        expect(size?.width).toBe('100%');
        expect(size?.height).toBeUndefined();

        size?.apply({ width: undefined, height: undefined }, EMBEDDED_SRC);
        expect(committed).not.toContain('width=');
        expect(committed).not.toContain('height=');
    });
});
