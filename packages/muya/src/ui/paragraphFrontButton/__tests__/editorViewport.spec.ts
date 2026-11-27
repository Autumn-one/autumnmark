// @vitest-environment happy-dom

import type { MiddlewareState } from '@floating-ui/dom';
import type Parent from '../../../block/base/parent';
import type { Muya } from '../../../index';
import type { IEditorViewportConstraintData } from '../../utils/editorViewport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventCenter from '../../../event';
import {
    constrainToEditorViewport,
    isPointerInEditorViewport,
} from '../../utils/editorViewport';
import { ParagraphFrontButton } from '../index';

function mockRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
    } as DOMRect;
}

function setClientDimensions(el: HTMLElement, width: number, height: number, clientLeft = 0, clientTop = 0) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
    Object.defineProperty(el, 'clientLeft', { configurable: true, value: clientLeft });
    Object.defineProperty(el, 'clientTop', { configurable: true, value: clientTop });
}

function makeMiddlewareState(params: {
    x?: number;
    y: number;
    refY: number;
    refHeight: number;
    floatHeight: number;
    overflow: { top: number; right: number; bottom: number; left: number };
}): MiddlewareState {
    const { x = 40, y, refY, refHeight, floatHeight, overflow } = params;
    return {
        x,
        y,
        initialPlacement: 'left-start',
        placement: 'left-start',
        strategy: 'absolute',
        middlewareData: {},
        rects: {
            reference: { x: 80, y: refY, width: 400, height: refHeight },
            floating: { x, y, width: 20, height: floatHeight },
        },
        elements: {
            reference: document.createElement('div'),
            floating: document.createElement('div'),
        },
        platform: {
            detectOverflow: vi.fn().mockResolvedValue(overflow),
        },
    } as unknown as MiddlewareState;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('isPointerInEditorViewport', () => {
    it('accepts pointers inside a nested scroll container and rejects tab bar, sidebar, and sibling overlays', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });

        const tabs = document.createElement('div');
        const sidebar = document.createElement('div');
        const wrapper = document.createElement('div');
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        const domNode = document.createElement('div');
        const para = document.createElement('p');
        const searchBar = document.createElement('div');
        const floatBox = document.createElement('div');

        domNode.appendChild(para);
        scroller.appendChild(domNode);
        wrapper.append(scroller, searchBar);
        document.body.append(tabs, sidebar, wrapper, floatBox);

        scroller.getBoundingClientRect = () => mockRect(280, 68, 920, 732);
        setClientDimensions(scroller, 912, 732);

        const move = (target: EventTarget, clientX: number, clientY: number) => {
            const event = new MouseEvent('mousemove', { clientX, clientY, bubbles: true });
            Object.defineProperty(event, 'target', { configurable: true, value: target });
            return event;
        };

        expect(isPointerInEditorViewport(move(para, 400, 120), domNode, floatBox)).toBe(true);
        // Blank gutter inside the scroll container (outside .mu-container) stays eligible.
        expect(isPointerInEditorViewport(move(scroller, 290, 120), domNode, floatBox)).toBe(true);
        expect(isPointerInEditorViewport(move(floatBox, 310, 80), domNode, floatBox)).toBe(true);

        // Chrome & sibling overlays outside the scroll container are rejected.
        expect(isPointerInEditorViewport(move(tabs, 400, 50), domNode, floatBox)).toBe(false);
        expect(isPointerInEditorViewport(move(sidebar, 260, 120), domNode, floatBox)).toBe(false);
        expect(isPointerInEditorViewport(move(searchBar, 900, 90), domNode, floatBox)).toBe(false);
        // A floatBox coordinate outside the scrollport is rejected.
        expect(isPointerInEditorViewport(move(floatBox, 310, 50), domNode, floatBox)).toBe(false);
        // Coordinates over the vertical scrollbar (clientWidth = 912, right = 1192) are rejected.
        expect(isPointerInEditorViewport(move(scroller, 1195, 120), domNode, floatBox)).toBe(false);
    });

    it('handles document-level scrolling when no ancestor scrolls', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 700 });

        const header = document.createElement('header');
        const host = document.createElement('div');
        const domNode = document.createElement('div');
        const para = document.createElement('p');
        const floatBox = document.createElement('div');

        domNode.appendChild(para);
        host.appendChild(domNode);
        document.body.append(header, host, floatBox);

        const move = (target: EventTarget, clientX: number, clientY: number) => {
            const event = new MouseEvent('mousemove', { clientX, clientY, bubbles: true });
            Object.defineProperty(event, 'target', { configurable: true, value: target });
            return event;
        };

        expect(isPointerInEditorViewport(move(para, 200, 100), domNode, floatBox)).toBe(true);
        expect(isPointerInEditorViewport(move(host, 50, 100), domNode, floatBox)).toBe(true);
        expect(isPointerInEditorViewport(move(header, 200, 20), domNode, floatBox)).toBe(false);
        expect(isPointerInEditorViewport(move(para, 200, -5), domNode, floatBox)).toBe(false);
    });
});

describe('constrainToEditorViewport middleware', () => {
    it('keeps natural coordinates when the float fits inside the clip rect', async () => {
        const mw = constrainToEditorViewport();
        const state = makeMiddlewareState({
            y: 120,
            refY: 120,
            refHeight: 26,
            floatHeight: 26,
            overflow: { top: -52, right: -400, bottom: -500, left: -30 },
        });
        const result = await mw.fn(state);
        expect(result.y).toBe(120);
        expect((result.data as IEditorViewportConstraintData).clipped).toBe(false);
    });

    it('clamps vertically to the clip top when a tall block extends below it', async () => {
        const mw = constrainToEditorViewport();
        const state = makeMiddlewareState({
            y: 44,
            refY: 44,
            refHeight: 240,
            floatHeight: 26,
            overflow: { top: 24, right: -400, bottom: -600, left: -30 },
        });
        const result = await mw.fn(state);
        expect(result.y).toBe(68);
        expect((result.data as IEditorViewportConstraintData).clipped).toBe(false);
    });

    it('marks clipped when the remaining visible sliver of the block is shorter than the float', async () => {
        const mw = constrainToEditorViewport();
        const state = makeMiddlewareState({
            y: -150,
            refY: -150,
            refHeight: 230,
            floatHeight: 26,
            overflow: { top: 218, right: -400, bottom: -600, left: -30 },
        });
        const result = await mw.fn(state);
        expect((result.data as IEditorViewportConstraintData).clipped).toBe(true);
    });

    it('marks clipped when a single-line block or thematic break partially crosses the top edge', async () => {
        const mw = constrainToEditorViewport();
        const state = makeMiddlewareState({
            y: 62,
            refY: 62,
            refHeight: 26,
            floatHeight: 26,
            overflow: { top: 6, right: -400, bottom: -600, left: -30 },
        });
        const result = await mw.fn(state);
        expect((result.data as IEditorViewportConstraintData).clipped).toBe(true);
    });

    it('marks clipped on horizontal or bottom overflow instead of flipping onto content', async () => {
        const mw = constrainToEditorViewport();

        const leftOverflow = await mw.fn(makeMiddlewareState({
            y: 120,
            refY: 120,
            refHeight: 200,
            floatHeight: 26,
            overflow: { top: -52, right: -400, bottom: -500, left: 10 },
        }));
        expect((leftOverflow.data as IEditorViewportConstraintData).clipped).toBe(true);

        const bottomOverflow = await mw.fn(makeMiddlewareState({
            y: 785,
            refY: 785,
            refHeight: 200,
            floatHeight: 26,
            overflow: { top: -717, right: -400, bottom: 11, left: -30 },
        }));
        expect((bottomOverflow.data as IEditorViewportConstraintData).clipped).toBe(true);
    });

    it('marks clipped when clamping down would push the float past the bottom of a tiny viewport', async () => {
        const mw = constrainToEditorViewport();
        const state = makeMiddlewareState({
            y: 50,
            refY: 50,
            refHeight: 200,
            floatHeight: 26,
            overflow: { top: 18, right: -400, bottom: -10, left: -30 },
        });
        const result = await mw.fn(state);
        expect((result.data as IEditorViewportConstraintData).clipped).toBe(true);
    });
});

describe('paragraphFrontButton clipped state lifecycle', () => {
    it('keeps _status active while parked offscreen so hide() cleans up and the same block can show again', async () => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        const domNode = document.createElement('div');
        const blockEl = document.createElement('p');
        blockEl.style.lineHeight = '26px';
        domNode.appendChild(blockEl);
        scroller.appendChild(domNode);
        document.body.appendChild(scroller);

        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
        scroller.getBoundingClientRect = () => mockRect(280, 68, 920, 732);
        setClientDimensions(scroller, 920, 732);

        const eventCenter = new EventCenter();
        const muya = { domNode, eventCenter, isReadOnly: false } as unknown as Muya;
        const button = new ParagraphFrontButton(muya);
        const wrapper = document.querySelector<HTMLElement>('.mu-front-button-wrapper')!;
        const inner = wrapper.querySelector<HTMLElement>('.mu-front-button')!;
        Object.defineProperty(inner, 'offsetWidth', { configurable: true, value: 20 });
        Object.defineProperty(inner, 'offsetHeight', { configurable: true, value: 26 });
        Object.defineProperty(wrapper, 'offsetWidth', { configurable: true, value: 20 });
        Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 26 });

        const block = {
            blockName: 'paragraph',
            domNode: blockEl,
            isOutMostBlock: true,
        } as unknown as Parent;

        // Place the single-line block partially above the scrollport top (y = 58 < 68)
        // so it must park offscreen as clipped.
        blockEl.getBoundingClientRect = () => mockRect(354, 58, 600, 26);
        wrapper.getBoundingClientRect = () => mockRect(-9999, -9999, 20, 26);

        button.show(block);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(wrapper.style.opacity).toBe('0');
        expect(wrapper.style.top).toBe('-9999px');

        // Scroll dismisses via hide(). Because _status remained true while parked,
        // hide() clears _block so re-showing the same block after scrolling into view works.
        button.hide();
        blockEl.getBoundingClientRect = () => mockRect(354, 120, 600, 26);
        button.show(block);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(wrapper.style.opacity).toBe('1');
        expect(Number.parseFloat(wrapper.style.top)).toBe(120);

        button.destroy();
    });
});
