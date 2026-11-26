// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type Format from '../../block/base/format';
import type AtxHeading from '../../block/commonMark/atxHeading';
import type Table from '../../block/gfm/table';
import type { ISelectionChangePayload, TSelectionState } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { getImageInfo } from '../../utils/image';
import { SelectionType } from '../types';

const bootedMuyas: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedMuyas.length) {
        const muya = bootedMuyas.pop()!;
        muya.destroy();
        muya.domNode.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init({ focus: false });
    bootedMuyas.push(muya);
    return muya;
}

function placeNativeCaretAtStart(block: Content, { silent = true } = {}): void {
    const node = block.domNode!;
    const range = document.createRange();
    const firstChild = node.firstChild;
    if (firstChild && firstChild.nodeType === Node.TEXT_NODE)
        range.setStart(firstChild, 0);
    else
        range.setStart(node, 0);
    range.collapse(true);
    const sel = document.getSelection()!;
    if (!silent) {
        sel.removeAllRanges();
        sel.addRange(range);
        return;
    }
    // happy-dom fires selectionchange synchronously inside removeAllRanges/addRange,
    // whereas Blink queues selectionchange after focus. Suppress it during setup so the
    // test exercises the real pre-selectionchange focus ordering.
    const originalDispatch = document.dispatchEvent.bind(document);
    const spy = vi.spyOn(document, 'dispatchEvent').mockImplementation((event: Event) => {
        if (event.type === 'selectionchange')
            return true;
        return originalDispatch(event);
    });
    try {
        sel.removeAllRanges();
        sel.addRange(range);
    }
    finally {
        spy.mockRestore();
    }
}

function clearNativeSelectionSilently(): void {
    const originalDispatch = document.dispatchEvent.bind(document);
    const spy = vi.spyOn(document, 'dispatchEvent').mockImplementation((event: Event) => {
        if (event.type === 'selectionchange')
            return true;
        return originalDispatch(event);
    });
    try {
        document.getSelection()!.removeAllRanges();
    }
    finally {
        spy.mockRestore();
    }
}

function storedState(muya: Muya): TSelectionState | null {
    return (muya.editor.selection as unknown as { _state: TSelectionState | null })._state;
}

function hasLiveNativeFlag(muya: Muya): boolean {
    return (muya.editor.selection as unknown as { _hasLiveNativeSelection: boolean })._hasLiveNativeSelection;
}

function flushNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function nextMacrotask(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('root non-pointer focus selection recovery', () => {
    it('restores the cached tail caret with preventScroll when Blink synthesizes block 0 on non-pointer focus', async () => {
        const muya = bootMuya('# Top heading\n\nMiddle paragraph\n\nBottom paragraph\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;

        last.setCursor(3, 3, true);
        expect(hasLiveNativeFlag(muya)).toBe(true);

        // Simulate Excalidraw clearing the native selection while the dialog is open.
        document.getSelection()!.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
        expect(hasLiveNativeFlag(muya)).toBe(false);

        const events: ISelectionChangePayload[] = [];
        muya.on('selection-change', (payload: unknown) => {
            events.push(payload as ISelectionChangePayload);
        });

        // Simulate Blink synthesizing a collapsed caret at block 0 before dispatching focus,
        // without an intervening selectionchange.
        placeNativeCaretAtStart(first);
        muya.domNode.dispatchEvent(new FocusEvent('focus'));

        expect(storedState(muya)).toEqual({
            kind: SelectionType.TEXT,
            anchor: { path: last.path, offset: 3 },
            focus: { path: last.path, offset: 3 },
        });
        expect(last.domNode!.contains(document.getSelection()!.anchorNode)).toBe(true);
        for (const payload of events)
            expect(payload.preventScroll).toBe(true);

        // The queued selectionchange from focus must not emit a scroll-enabling notification.
        document.dispatchEvent(new Event('selectionchange'));
        await flushNextFrame();
        for (const payload of events)
            expect(payload.preventScroll).toBe(true);
    });

    it('does not interfere when pointerdown precedes focus with an empty native selection', async () => {
        const muya = bootMuya('# Top heading\n\nBottom paragraph\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;

        last.setCursor(2, 2, true);
        document.getSelection()!.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));

        const events: ISelectionChangePayload[] = [];
        muya.on('selection-change', (payload: unknown) => {
            events.push(payload as ISelectionChangePayload);
        });

        // Real pointer click sequence: pointerdown -> focus while rangeCount is still 0.
        muya.domNode.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        muya.domNode.dispatchEvent(new FocusEvent('focus'));

        // Assert before placing the clicked range so a false recovery cannot be masked.
        expect(document.getSelection()!.rangeCount).toBe(0);
        expect(events).toHaveLength(0);
        expect(storedState(muya)).toEqual({
            kind: SelectionType.TEXT,
            anchor: { path: last.path, offset: 2 },
            focus: { path: last.path, offset: 2 },
        });

        // Browser places the caret where the user clicked and fires selectionchange.
        placeNativeCaretAtStart(first);
        document.dispatchEvent(new Event('selectionchange'));
        await flushNextFrame();
        expect(storedState(muya)).toEqual({
            kind: SelectionType.TEXT,
            anchor: { path: first.path, offset: 0 },
            focus: { path: first.path, offset: 0 },
        });
    });

    it('recomputes native selection presence on preserveFocus setSelection even without selectionchange', () => {
        const muya = bootMuya('# Top heading\n\nBottom paragraph\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;

        last.setCursor(4, 4, true);
        const tailState = muya.getSelectionState()!;
        expect(hasLiveNativeFlag(muya)).toBe(true);

        // Native selection disappears without an intervening selectionchange, then an
        // in-place/rebuild update commits with preserveFocus: true.
        clearNativeSelectionSilently();
        muya.setSelection(tailState, { preventScroll: true, preserveFocus: true });
        expect(hasLiveNativeFlag(muya)).toBe(false);

        placeNativeCaretAtStart(first);
        muya.domNode.dispatchEvent(new FocusEvent('focus'));

        expect(storedState(muya)).toEqual(tailState);
        expect(last.domNode!.contains(document.getSelection()!.anchorNode)).toBe(true);
    });

    it('keeps _state intact during focus and suppresses scroll when writeback target lacks a connected domNode', async () => {
        const muya = bootMuya('# Top heading\n\nBottom paragraph\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;

        last.setCursor(2, 2, true);
        const tailState = muya.getSelectionState()!;
        document.getSelection()!.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));

        const originalDom = last.domNode;
        last.domNode = null;
        try {
            const events: ISelectionChangePayload[] = [];
            muya.on('selection-change', (payload: unknown) => {
                events.push(payload as ISelectionChangePayload);
            });

            placeNativeCaretAtStart(first);
            muya.domNode.dispatchEvent(new FocusEvent('focus'));

            // Focus must not flush and overwrite _state with block 0 when target cannot be written.
            expect(storedState(muya)).toEqual(tailState);
            expect(events).toHaveLength(0);

            // Subsequent browser selectionchange carries preventScroll: true.
            document.dispatchEvent(new Event('selectionchange'));
            await flushNextFrame();
            expect(events).toHaveLength(1);
            expect(events[0].preventScroll).toBe(true);
        }
        finally {
            last.domNode = originalDom;
        }
    });

    it('does not expand folded blocks on non-pointer focus and expires focus scroll suppression after one macrotask', async () => {
        const muya = bootMuya('# Intro\n\n## Folded section\n\nHidden body\n');
        const heading = muya.editor.scrollPage!.find(1) as AtxHeading;
        const hiddenBody = muya.editor.scrollPage!.lastContentInDescendant()!;
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        heading.toggleFold(true);
        expect(heading.folded).toBe(true);

        clearNativeSelectionSilently();
        muya.setSelection({
            kind: SelectionType.TEXT,
            anchor: { path: hiddenBody.path, offset: 2 },
            focus: { path: hiddenBody.path, offset: 2 },
        }, { preventScroll: true, preserveFocus: true });
        expect(hasLiveNativeFlag(muya)).toBe(false);

        const events: ISelectionChangePayload[] = [];
        muya.on('selection-change', (payload: unknown) => {
            events.push(payload as ISelectionChangePayload);
        });

        placeNativeCaretAtStart(first);
        muya.domNode.dispatchEvent(new FocusEvent('focus'));
        expect(heading.folded).toBe(true);

        document.dispatchEvent(new Event('selectionchange'));
        await flushNextFrame();
        expect(events).toHaveLength(1);
        expect(events[0].preventScroll).toBe(true);

        // Verify expiration when no selectionchange arrives after focus: after one macrotask,
        // the next user selectionchange must not inherit preventScroll.
        events.length = 0;
        muya.editor.selection.clear();
        document.getSelection()!.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
        await flushNextFrame();
        events.length = 0;

        muya.domNode.dispatchEvent(new FocusEvent('focus'));
        await nextMacrotask();

        placeNativeCaretAtStart(first);
        document.dispatchEvent(new Event('selectionchange'));
        await flushNextFrame();
        expect(events).toHaveLength(1);
        expect(events[0].preventScroll).toBeUndefined();
    });

    it('handles IMAGE/TABLE selections, same-tick blur(true) refocus, and domNode.focus() followed by muya.focus()', async () => {
        // 1. IMAGE selection clears Blink's synthetic range without clobbering image selection.
        const imageMuya = bootMuya('# Top\n\n![alt](image.png)\n');
        const firstImgDoc = imageMuya.editor.scrollPage!.firstContentInDescendant()!;
        const imagePara = imageMuya.editor.scrollPage!.lastContentInDescendant()! as Format;
        const wrapper = imagePara.domNode!.querySelector<HTMLElement>('.mu-inline-image')!;
        imageMuya.editor.selection.selectImage({
            ...getImageInfo(wrapper),
            block: imagePara,
        });
        placeNativeCaretAtStart(firstImgDoc);
        imageMuya.domNode.dispatchEvent(new FocusEvent('focus'));
        expect(document.getSelection()!.rangeCount).toBe(0);
        expect(imageMuya.editor.selection.type).toBe(SelectionType.IMAGE);

        // 2. TABLE selection clears Blink's synthetic range without clobbering table selection.
        const tableMuya = bootMuya('# Top\n\n| a | b |\n| --- | --- |\n| c | d |\n');
        const firstTblDoc = tableMuya.editor.scrollPage!.firstContentInDescendant()!;
        const table = tableMuya.editor.scrollPage!.lastContentInDescendant()!.closestBlock('table') as Table;
        tableMuya.editor.selection.table.selectTable(table);
        placeNativeCaretAtStart(firstTblDoc);
        tableMuya.domNode.dispatchEvent(new FocusEvent('focus'));
        expect(document.getSelection()!.rangeCount).toBe(0);
        expect(tableMuya.editor.selection.type).toBe(SelectionType.TABLE);

        // 3. Same-tick blur(true) -> domNode.focus() (without intermediate selectionchange) restores tail block.
        const blurMuya = bootMuya('# Top\n\nTail block\n');
        const firstBlurDoc = blurMuya.editor.scrollPage!.firstContentInDescendant()!;
        const lastBlurDoc = blurMuya.editor.scrollPage!.lastContentInDescendant()!;
        lastBlurDoc.setCursor(4, 4, true);
        const origDispatch = document.dispatchEvent.bind(document);
        const blurSpy = vi.spyOn(document, 'dispatchEvent').mockImplementation((event: Event) => {
            if (event.type === 'selectionchange')
                return true;
            return origDispatch(event);
        });
        try {
            blurMuya.blur(true);
        }
        finally {
            blurSpy.mockRestore();
        }
        placeNativeCaretAtStart(firstBlurDoc);
        blurMuya.domNode.dispatchEvent(new FocusEvent('focus'));
        expect(storedState(blurMuya)).toEqual({
            kind: SelectionType.TEXT,
            anchor: { path: lastBlurDoc.path, offset: 4 },
            focus: { path: lastBlurDoc.path, offset: 4 },
        });
        expect(lastBlurDoc.domNode!.contains(document.getSelection()!.anchorNode)).toBe(true);

        // 4. editor.vue focusEditor pattern: domNode.focus() immediately followed by muya.focus().
        blurMuya.blur(true);
        placeNativeCaretAtStart(firstBlurDoc);
        blurMuya.domNode.dispatchEvent(new FocusEvent('focus'));
        blurMuya.focus();
        expect(blurMuya.editor.activeContentBlock).toBe(lastBlurDoc);
        expect(storedState(blurMuya)).toEqual({
            kind: SelectionType.TEXT,
            anchor: { path: lastBlurDoc.path, offset: 4 },
            focus: { path: lastBlurDoc.path, offset: 4 },
        });
        await nextMacrotask();
    });
});
