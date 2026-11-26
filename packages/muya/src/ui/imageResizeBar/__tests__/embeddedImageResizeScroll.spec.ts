// @vitest-environment happy-dom

import type { ISelectionChangePayload } from '../../../selection/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResizeBar } from '..';
import { CLASS_NAMES } from '../../../config';
import { Muya } from '../../../muya';

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

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        editEmbeddedImage: () => {},
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

function setBox(element: HTMLElement, width: number, height = 80) {
    element.getBoundingClientRect = () =>
        ({ top: 100, left: 20, right: 20 + width, bottom: 100 + height, width, height, x: 20, y: 100, toJSON: () => '' }) as DOMRect;
}

function dragRightHandle(img: HTMLImageElement, initialWidth: number, deltaX: number) {
    setBox(img, initialWidth);
    img.dispatchEvent(mouseEvent('mouseover', 20, { buttons: 0 }));
    vi.runAllTimers();
    const handle = document.querySelector<HTMLElement>('.mu-transformer .bar.right')!;
    expect(handle).not.toBeNull();
    handle.dispatchEvent(mouseEvent('mousedown', 100));
    document.dispatchEvent(mouseEvent('mousemove', 100 + deltaX));
    document.dispatchEvent(mouseEvent('mouseup', 100 + deltaX));
}

describe('image resize bar hover drag does not scroll to offscreen caret', () => {
    it('sets preventScroll on selection-change when releasing a dragged embedded image', () => {
        vi.useFakeTimers();
        const muya = boot(`# Top Heading\n\n![pic](${EMBEDDED_SRC})`);
        const img = muya.domNode.querySelector<HTMLImageElement>('.mu-embedded-picture img')!;
        expect(img).not.toBeNull();

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        dragRightHandle(img, 120, 80);

        expect(muya.getMarkdown()).toContain('width="200"');
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({
            docChanged: true,
            preventScroll: true,
        });

        // A later caret move must resume normal scroll-follow behavior.
        const firstContent = muya.editor.scrollPage!.firstContentInDescendant()!;
        firstContent.setCursor(1, 1);
        expect(payloads).toHaveLength(2);
        expect(payloads[1]!.preventScroll).toBeUndefined();
    });

    it('sets preventScroll on selection-change when releasing a hovered linked image', () => {
        vi.useFakeTimers();
        const muya = boot(`# Top Heading\n\n![pic](${LINKED_SRC})`);
        const container = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!;
        const img = document.createElement('img');
        img.setAttribute('src', LINKED_SRC);
        container.appendChild(img);

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        dragRightHandle(img, 120, 60);

        expect(muya.getMarkdown()).toContain('width="180"');
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({
            docChanged: true,
            preventScroll: true,
        });
    });

    it('skips emitting a change when releasing an embedded image at its existing width', () => {
        vi.useFakeTimers();
        const muya = boot(`# Top Heading\n\n<img title="" src="${EMBEDDED_SRC}" alt="pic" width="120" />`);
        const img = muya.domNode.querySelector<HTMLImageElement>('.mu-embedded-picture img')!;

        const payloads: ISelectionChangePayload[] = [];
        muya.on('selection-change', payload => payloads.push(payload));

        dragRightHandle(img, 120, 0);

        expect(payloads).toHaveLength(0);
        const firstContent = muya.editor.scrollPage!.firstContentInDescendant()!;
        firstContent.setCursor(1, 1);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]!.preventScroll).toBeUndefined();
    });
});
