import type { TTableColumnWidth } from '../../../state/types';
import type TableBodyCell from './cell';
import { BLOCK_DOM_PROPERTY } from '../../../config';
import { displayColumnWidth } from './cell';

interface IColumn {
    header: HTMLTableCellElement;
    cells?: HTMLTableCellElement[];
    original?: TTableColumnWidth;
    width: number;
}

export class ColumnResize {
    readonly reservedWidth: number;
    private _rows: HTMLTableRowElement[];
    private _target: IColumn;
    private _anchors: IColumn[];
    private _trailingFill?: IColumn;
    private _preview?: TTableColumnWidth;

    constructor(grid: HTMLTableElement, index: number) {
        this._rows = Array.from(grid.rows);
        const header = Array.from(this._rows[0].cells);
        const left = header[0].getBoundingClientRect().left;
        let previousEdge = 0;
        const columns = header.map((cell) => {
            const edge = Math.round(cell.getBoundingClientRect().right - left);
            // Round cumulative positions so fractional pixels do not accumulate across a wide table.
            const width = edge - previousEdge;
            previousEdge = edge;
            return {
                header: cell,
                original: (cell[BLOCK_DOM_PROPERTY] as TableBodyCell).meta.width,
                width,
            };
        });
        this._target = columns[index];
        this._preview = this._target.original;
        this._trailingFill = columns.find((column, i) => i > index && column.original === '100%');
        this._anchors = columns.filter((column, i) => i !== index && column.original !== column.width
            && (i < index || typeof column.original === 'number'));

        const previousWidth = grid.style.width;
        grid.style.width = 'min-content';
        const minimum = grid.getBoundingClientRect().width;
        const minima = header.map(cell => cell.getBoundingClientRect().width);
        grid.style.width = previousWidth;
        let reserved = minimum - minima[index];
        for (const [i, column] of columns.entries()) {
            if (i < index || (i > index && typeof column.original === 'number'))
                reserved += column.width - minima[i];
        }
        const style = getComputedStyle(grid.parentElement!);
        this.reservedWidth = reserved + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    }

    preview(size?: TTableColumnWidth) {
        if (this._preview === size)
            return;
        const active = size !== this._target.original;
        const wasActive = this._preview !== this._target.original;
        this._preview = size;
        if (active !== wasActive) {
            for (const column of this._anchors)
                this._display(column, active ? column.width : column.original);
        }
        if (this._trailingFill)
            this._display(this._trailingFill, size === '100%' ? undefined : '100%');
        this._display(this._target, size);
    }

    /** Keep automatic sizing wherever restoring it reproduces the drop position. */
    widthsForCommit(): Map<number, number> {
        const edge = this._target.header.getBoundingClientRect().right;
        for (const column of this._anchors) {
            const transferFill = column.original === '100%' && this._preview === '100%';
            this._display(column, transferFill ? undefined : column.original);
        }
        const displaced = (column: IColumn) => Math.abs(column.header.getBoundingClientRect().width - column.width) >= 1;
        let needed = this._anchors.filter(displaced);
        for (const column of needed)
            this._display(column, column.width);
        if (this._anchors.some(displaced) || Math.abs(this._target.header.getBoundingClientRect().right - edge) >= 1)
            needed = this._anchors;
        return new Map(needed.map(column => [column.header.cellIndex, column.width]));
    }

    private _display(column: IColumn, size?: TTableColumnWidth) {
        column.cells ??= this._rows.map(row => row.cells[column.header.cellIndex]);
        for (const cell of column.cells)
            displayColumnWidth(cell, size);
    }
}
