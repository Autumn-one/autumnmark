// @vitest-environment happy-dom

import type AtxHeading from '../../block/commonMark/atxHeading';
import type { TSelectionState } from '../../selection/types';
import { describe, expect, it, vi } from 'vitest';
import { bootMuya, useMuyaHarness } from '../../__tests__/muyaHarness';
import { SelectionType } from '../../selection/types';

useMuyaHarness();

describe('preserveFocus selection restoration', () => {
    it('updates logical text selection without calling addRange, domNode.focus, or exposing syntax', () => {
        const source = 'before\n\n[first](/one "first title")\n';
        const muya = bootMuya(source);
        const heading = muya.editor.scrollPage!.firstContentInDescendant()!;
        const linkBlock = heading.nextContentInContext()!;
        const offset = linkBlock.text.indexOf('title') + 2;
        linkBlock.setCursor(offset, offset, true);

        const external = document.createElement('textarea');
        document.body.appendChild(external);
        external.focus();

        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            muya.replaceContent('before updated\n\n[first](/one "first title")\n', undefined, {
                preventScroll: true,
                preserveFocus: true,
            });

            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(external);
            expect(muya.getSelectionState()).toEqual({
                kind: SelectionType.TEXT,
                anchor: { path: [1, 'text'], offset },
                focus: { path: [1, 'text'], offset },
            });
            const rebuiltLink = muya.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
            expect(rebuiltLink.domNode!.querySelector('.mu-gray')).toBeNull();

            // Subsequent explicit focus still restores the caret on the rebuilt block.
            muya.focus();
            expect(addRangeSpy).toHaveBeenCalled();
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
            external.remove();
        }
    });

    it('falls back logically without calling addRange when the saved selection is invalid after replaceContent', () => {
        const muya = bootMuya('first\n\nsecond paragraph\n');
        const second = muya.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
        second.setCursor(second.text.length, second.text.length, true);

        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            muya.replaceContent('only one\n', undefined, { preserveFocus: true });

            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
            expect(muya.getSelectionState()).toEqual({
                kind: SelectionType.TEXT,
                anchor: { path: [0, 'text'], offset: 0 },
                focus: { path: [0, 'text'], offset: 0 },
            });
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
        }
    });

    it('does not unfold a folded heading when setSelection uses preserveFocus', () => {
        const muya = bootMuya('# Section\n\nhidden body\n');
        const heading = muya.editor.scrollPage!.find(0) as AtxHeading;
        const body = heading.next!.firstContentInDescendant()!;
        heading.toggleFold(true);
        expect(heading.folded).toBe(true);

        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            const restored = muya.setSelection({
                kind: SelectionType.TEXT,
                anchor: { path: body.path, offset: 2 },
                focus: { path: body.path, offset: 2 },
            }, { preserveFocus: true });

            expect(restored).toBe(true);
            expect(heading.folded).toBe(true);
            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
        }
    });

    it('preserves a table rectangle selection without calling domNode.focus or addRange', () => {
        const tableMarkdown = '| a | b |\n| --- | --- |\n| c | d |\n\ntail\n';
        const muya = bootMuya(tableMarkdown);
        const selection: TSelectionState = {
            kind: SelectionType.TABLE,
            tablePath: [0],
            anchor: { row: 0, column: 0 },
            focus: { row: 1, column: 1 },
        };
        expect(muya.setSelection(selection)).toBe(true);

        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            muya.replaceContent('| a | b |\n| --- | --- |\n| c | d |\n\ntail updated\n', undefined, {
                preventScroll: true,
                preserveFocus: true,
            });

            expect(focusSpy).not.toHaveBeenCalled();
            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(muya.getSelectionState()).toEqual(selection);
            expect(muya.domNode.querySelectorAll('td.mu-table-cell-selected').length).toBeGreaterThan(0);
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
        }
    });

    it('does not call addRange or domNode.focus in setCursorByOffset when preserveFocus is true', () => {
        const muya = bootMuya('alpha beta\n\ngamma\n');
        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            const restored = muya.setCursorByOffset(
                { anchor: { line: 0, ch: 3 }, focus: { line: 0, ch: 3 } },
                { preserveFocus: true },
            );

            expect(restored).toBe(true);
            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
            expect(muya.getSelectionState()).toEqual({
                kind: SelectionType.TEXT,
                anchor: { path: [0, 'text'], offset: 3 },
                focus: { path: [0, 'text'], offset: 3 },
            });
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
        }
    });

    it('does not steal external focus when setSearchVisible or non-selecting search runs', () => {
        const muya = bootMuya('alpha beta\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(2, 2, true);

        const external = document.createElement('textarea');
        document.body.appendChild(external);
        external.focus();

        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            muya.setSearchVisible(false);
            muya.search('', { selectHighlight: false });

            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(external);
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
            external.remove();
        }
    });
});
