import type { Muya } from '../../../muya';
import type { TSelectionState } from '../../../selection/types';
import type { ITableRowState, ITableState, TTableColumnWidth } from '../../../state/types';
import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type TableCellContent from '../../content/tableCell';
import type { TBlockPath } from '../../types';
import type TableBodyCell from './cell';
import type TableRow from './row';
import type TableInner from './table';
import diff from 'fast-diff';
import { fromEvent } from 'rxjs';
import { diffToTextOp } from '../../../utils';
import logger from '../../../utils/logger';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';
import { selectionAfterTableMove } from './moveSelection';
import { attachTableResize } from './resize';

const debug = logger('table:');

class Table extends Parent {
    override children: LinkedList<TableInner> = new LinkedList();

    static override blockName = 'table';

    static create(muya: Muya, state: ITableState) {
        const table = new Table(muya);

        table.append(ScrollPage.loadBlock('table.inner').create(muya, state));

        return table;
    }

    static createWithHeader(muya: Muya, header: string[]) {
        const state: ITableState = {
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: header.map(c => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: c,
                    })),
                },
                {
                    name: 'table.row',
                    children: header.map(() => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: '',
                    })),
                },
            ],
        };

        return this.create(muya, state);
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    get rowCount() {
        return (this.firstChild as TableInner).length();
    }

    get columnCount() {
        return ((this.firstChild as TableInner).firstChild as TableRow).length();
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'figure';

        this.classList = ['mu-table'];
        this.createDomNode();
        this._listenDomEvent();
        attachTableResize(this);
    }

    isEmpty() {
        const state = this.getState();

        return state.children.every(row =>
            row.children.every(cell => cell.text === ''),
        );
    }

    private _listenDomEvent() {
        const { domNode } = this;

        // Fix: prevent cursor present at the end of table.
        const mousedownHandler = (event: Event) => {
            if (event.target === domNode) {
                event.preventDefault();
                const cursorBlock = this.lastContentInDescendant()!;
                const offset = cursorBlock.text.length;
                cursorBlock.setCursor(offset, offset, true);
            }
        };

        const mousedownObservable = fromEvent(domNode!, 'mousedown');
        mousedownObservable.subscribe(mousedownHandler);
    }

    queryBlock(path: TBlockPath) {
        // Table's only child at runtime is `TableInner` (the body wrapper),
        // which extends the queryBlock mixin and is always present.
        return (this.firstChild as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined }).queryBlock(path);
    }

    protected override empty() {
        if (this.isEmpty())
            return;

        const table = this.children.head;
        if (table == null)
            return;

        table.forEach((row) => {
            (row as TableRow).forEach((cell) => {
                ((cell as TableBodyCell).firstChild as TableCellContent).text = '';
            });
        });
    }

    setSize(axis: 'column' | 'row', index: number, pixels?: number): void;
    setSize(axis: 'column', index: number, width?: TTableColumnWidth, anchoredWidths?: ReadonlyMap<number, number>): void;
    setSize(axis: 'column' | 'row', index: number, size?: TTableColumnWidth, anchoredWidths?: ReadonlyMap<number, number>) {
        if (!this.muya.canMutate || !this.muya.isBlockInDocument(this))
            return;
        const state = this.getState();
        if (axis === 'column') {
            const previousFill = size === '100%' ? state.children[0].children.findIndex(cell => cell.meta.width === '100%') : -1;
            for (const row of state.children) {
                if (previousFill >= 0)
                    delete row.children[previousFill].meta.width;
                if (anchoredWidths) {
                    for (const [column, width] of anchoredWidths)
                        row.children[column].meta.width = width;
                }
                if (size)
                    row.children[index].meta.width = size;
                else
                    delete row.children[index].meta.width;
            }
        }
        else if (typeof size === 'number') {
            state.children[index].minHeight = size;
        }
        else {
            delete state.children[index].minHeight;
        }
        this._replaceTable(state, this.muya.getSelectionState());
    }

    move(axis: 'row' | 'column', from: number, to: number) {
        const min = axis === 'row' ? 1 : 0;
        const count = axis === 'row' ? this.rowCount : this.columnCount;
        if (!this.muya.canMutate || !this.muya.isBlockInDocument(this) || from === to
            || from < min || to < min || from >= count || to >= count) {
            return;
        }
        const state = this.getState();
        function moveItem<T>(items: T[]) {
            const [item] = items.splice(from, 1);
            items.splice(to, 0, item);
        }
        if (axis === 'row')
            moveItem(state.children);
        else
            state.children.forEach(row => moveItem(row.children));
        const selection = selectionAfterTableMove(this.muya.getSelectionState(), this.path, axis, from, to);
        this._replaceTable(state, selection);
    }

    private _replaceTable(state: ITableState, selection: TSelectionState | null) {
        const scrollLeft = this.domNode!.scrollLeft;
        this.muya.transact(() => {
            const replacement = Table.create(this.muya, state);
            this.replaceWith(replacement);
            replacement.domNode!.scrollLeft = scrollLeft;
            if (selection)
                this.muya.setSelection(selection);
        });
    }

    insertRow(offset: number) {
        const { columnCount } = this;
        const firstRowState = this.getState().children[0];
        const currentRow
            = offset > 0
                ? (this.firstChild as TableInner).find(offset - 1)
                : (this.firstChild as TableInner).find(offset);
        const state = {
            name: 'table.row',
            // eslint-disable-next-line unicorn/no-new-array
            children: [...new Array(columnCount)].map((_, i) => {
                return {
                    name: 'table.cell',
                    meta: { ...firstRowState.children[i].meta },
                    text: '',
                };
            }),
        };

        const rowBlock = ScrollPage.loadBlock('table.row').create(this.muya, state);

        if (offset > 0)
            (this.firstChild as TableInner).insertAfter(rowBlock, currentRow as TableRow);
        else
            (this.firstChild as TableInner).insertBefore(rowBlock, currentRow as TableRow);

        return rowBlock.firstContentInDescendant();
    }

    insertColumn(offset: number, align = 'none') {
        const tableInner = this.firstChild as TableInner;
        let firstCellInNewColumn: Nullable<TableBodyCell> = null;

        tableInner.forEach((row) => {
            const state = {
                name: 'table.cell',
                meta: { align },
                text: '',
            };
            const cell = ScrollPage.loadBlock('table.cell').create(this.muya, state);
            const ref = (row as TableRow).find(offset);

            (row as TableRow).insertBefore(cell, ref as TableBodyCell);
            if (!firstCellInNewColumn)
                firstCellInNewColumn = cell;
        });

        return firstCellInNewColumn!.firstChild as TableCellContent;
    }

    removeRow(offset: number): Nullable<Content> {
        const inner = this.firstChild as TableInner;
        const row = inner.find(offset);
        if (row == null)
            return;

        // Capture an attached neighbouring row before detaching the deleted one.
        const survivor = (row.next as TableRow | null) ?? (row.prev as TableRow | null);
        // Also capture a caret fallback outside the table in case the final row is removed.
        const outsideContent
            = this.nextContentInContext() ?? this.previousContentInContext();

        row.remove();

        if (survivor == null) {
            this.remove();
            return outsideContent ?? null;
        }

        return (survivor.firstChild as TableBodyCell).firstChild as TableCellContent;
    }

    removeColumn(offset: number): Nullable<Content> {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        if (this.columnCount === 1) {
            const outsideContent
                = this.nextContentInContext() ?? this.previousContentInContext();
            this.remove();
            return outsideContent ?? null;
        }

        // Capture a surviving cell before column deletion detaches its neighbour.
        const firstRow = table.firstChild as TableRow;
        const targetCellInFirstRow = firstRow.find(offset) as TableBodyCell | null;
        const neighbourCell
            = (targetCellInFirstRow?.next as TableBodyCell | null)
                ?? (targetCellInFirstRow?.prev as TableBodyCell | null);

        table.forEach((row) => {
            const cell = (row as TableRow).find(offset);
            if (cell)
                cell.remove();
        });

        return (neighbourCell?.firstChild as TableCellContent | undefined) ?? null;
    }

    alignColumn(offset: number, value: string) {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`Column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        table.forEach((row) => {
            const cell = (row as TableRow).find(offset) as TableBodyCell;
            if (cell) {
                const { align: oldValue } = cell;
                cell.align = oldValue === value ? 'none' : value;
                const diffs = diff(oldValue, cell.align);
                const { path } = cell;
                path.push('meta', 'align');

                this.transactions.editOperation(path, diffToTextOp(diffs));
            }
        });
    }

    // Zero-based row/column lookup; return null outside the table.
    cellAt(row: number, column: number): Nullable<TableBodyCell> {
        const rowBlock = (this.firstChild as TableInner).find(row) as TableRow | undefined;
        if (rowBlock == null)
            return null;

        return (rowBlock.find(column) as TableBodyCell | undefined) ?? null;
    }

    /**
     * Build an `ITableState` for the rectangular block of cells bounded by
     * (`startRow`, `startColumn`) and (`endRow`, `endColumn`) inclusive. The
     * bounds may be passed in any order — they are normalised — and are clamped
     * to the table's dimensions, so a copied cell rectangle round-trips to GFM
     * table markdown via `StateToMarkdown`. The first selected row becomes the
     * header
     * row of the resulting sub-table, preserving each cell's alignment.
     */
    getSubTableState(
        startRow: number,
        startColumn: number,
        endRow: number,
        endColumn: number,
    ): ITableState {
        const { rowCount, columnCount } = this;
        const minRow = Math.max(0, Math.min(startRow, endRow));
        const maxRow = Math.min(rowCount - 1, Math.max(startRow, endRow));
        const minColumn = Math.max(0, Math.min(startColumn, endColumn));
        const maxColumn = Math.min(columnCount - 1, Math.max(startColumn, endColumn));

        const children: ITableState['children'] = [];
        for (let r = minRow; r <= maxRow; r++) {
            const cells: ITableRowState['children'] = [];
            for (let c = minColumn; c <= maxColumn; c++) {
                const cell = this.cellAt(r, c);
                if (cell)
                    cells.push(cell.getState());
            }
            const minHeight = this.cellAt(r, minColumn)?.row.minHeight;
            children.push({ name: 'table.row', ...(minHeight && { minHeight }), children: cells });
        }

        return { name: 'table', children };
    }

    override getState(): ITableState {
        return (this.firstChild as TableInner).getState();
    }
}

export default Table;
