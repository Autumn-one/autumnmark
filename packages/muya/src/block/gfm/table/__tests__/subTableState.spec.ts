// @vitest-environment happy-dom

import type Table from '..';
import type { ITableState } from '../../../../state/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

const TABLE_MD = [
    '| a1 | b1 | c1 |',
    '| --- | --- | --- |',
    '| a2 | b2 | c2 |',
    '| a3 | b3 | c3 |',
    '',
].join('\n');

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function firstTable(muya: Muya): Table {
    const block = muya.editor.scrollPage!.firstContentInDescendant()!.closestBlock('table');
    return block as Table;
}

function cellTexts(state: ITableState): string[][] {
    return state.children.map(row => row.children.map(cell => cell.text));
}

describe('sparse table sizes', () => {
    it('keeps the caret in the moved cell after reordering either axis', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        table.cellAt(1, 1)!.firstContentInDescendant()!.setCursor(1, 1, true);
        table.move('row', 1, 2);
        firstTable(muya).move('column', 1, 0);
        const selection = muya.getSelection();
        expect(selection?.kind).toBe('text');
        if (selection?.kind === 'text') {
            expect(selection.context.anchorBlock.text).toBe('b2');
            expect(selection.anchor.offset).toBe(1);
        }
    });

    it('renumbers sizes across insert and delete, including sub-table copies', () => {
        const muya = bootMuya(`<!-- table-layout: col-widths="2:120" row-min-heights="3:64" -->\n\n${TABLE_MD}`);
        const table = firstTable(muya);
        muya.transact(() => {
            table.insertRow(1);
            table.insertColumn(0);
        });
        expect(muya.getMarkdown()).toContain('col-widths="3:120" row-min-heights="4:64"');
        expect(table.cellAt(1, 2)?.meta.width).toBe(120);
        const subset = table.getSubTableState(2, 1, 3, 2);
        expect(subset.children[0].children[1].meta.width).toBe(120);
        expect(subset.children[1].minHeight).toBe(64);
        muya.transact(() => {
            table.removeColumn(2);
            table.removeRow(3);
        });
        expect(muya.getMarkdown()).not.toContain('table-layout');
        muya.undo();
        expect(muya.getMarkdown()).toContain('col-widths="3:120" row-min-heights="4:64"');
    });
});

describe('table.cellAt', () => {
    it('resolves a body cell by (row, column) offsets', () => {
        const table = firstTable(bootMuya(TABLE_MD));
        const cell = table.cellAt(2, 1); // 3rd row, 2nd column => "b3"
        expect(cell).not.toBeNull();
        expect(cell!.getState().text).toBe('b3');
    });

    it('returns null for an out-of-range row or column', () => {
        const table = firstTable(bootMuya(TABLE_MD));
        expect(table.cellAt(9, 0)).toBeNull();
        expect(table.cellAt(0, 9)).toBeNull();
    });
});

describe('table.getSubTableState', () => {
    it('extracts the rectangle between two corners (header becomes the sub-table header)', () => {
        const table = firstTable(bootMuya(TABLE_MD));
        const state = table.getSubTableState(0, 0, 1, 1);
        expect(cellTexts(state)).toEqual([
            ['a1', 'b1'],
            ['a2', 'b2'],
        ]);
    });

    it('normalises reversed bounds (focus before anchor)', () => {
        const table = firstTable(bootMuya(TABLE_MD));
        const state = table.getSubTableState(2, 2, 1, 1);
        expect(cellTexts(state)).toEqual([
            ['b2', 'c2'],
            ['b3', 'c3'],
        ]);
    });

    it('clamps bounds that exceed the table dimensions', () => {
        const table = firstTable(bootMuya(TABLE_MD));
        const state = table.getSubTableState(0, 0, 99, 99);
        expect(cellTexts(state)).toEqual([
            ['a1', 'b1', 'c1'],
            ['a2', 'b2', 'c2'],
            ['a3', 'b3', 'c3'],
        ]);
    });

    it('preserves per-column alignment in the extracted cells', () => {
        const aligned = [
            '| h1 | h2 |',
            '| :--- | ---: |',
            '| x | y |',
            '',
        ].join('\n');
        const table = firstTable(bootMuya(aligned));
        const state = table.getSubTableState(0, 0, 1, 1);
        expect(state.children[0].children[0].meta.align).toBe('left');
        expect(state.children[0].children[1].meta.align).toBe('right');
    });
});
