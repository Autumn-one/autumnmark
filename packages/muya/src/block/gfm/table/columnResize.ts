import type Table from '.';
import type { TTableColumnWidth } from '../../../state/types';
import type TableInner from './table';
import { displayColumnWidth } from './cell';
import { scaleSizes } from './resizeDimensions';

const MIN_WIDTH = 36;

type ColumnWidth = TTableColumnWidth | undefined;

export class ColumnResize {
    private _table: TableInner;
    private _cells: HTMLTableCellElement[][];
    private _widths: number[];
    private _minima: number[];
    private _original: ColumnWidth[];
    private _displayed: ColumnWidth[];
    private _total: number;
    private _available: number;
    private _index: number;
    private _previewFill = -1;

    constructor(table: TableInner, index: number) {
        this._table = table;
        const grid = table.domNode as HTMLTableElement;
        const rows = Array.from(grid.rows);
        const headers = Array.from(rows[0].cells);
        this._cells = headers.map((_, i) => rows.map(row => row.cells[i]));
        this._original = table.children.head!.children.map(cell => cell.meta.width);
        this._displayed = [...this._original];
        const left = headers[0].getBoundingClientRect().left;
        let previous = 0;
        this._widths = headers.map((cell) => {
            const right = Math.round(cell.getBoundingClientRect().right - left);
            const width = right - previous;
            previous = right;
            return width;
        });
        this._total = previous;
        const figure = grid.parentElement!;
        const style = getComputedStyle(figure);
        const extra = grid.getBoundingClientRect().width - previous;
        this._available = Math.round(figure.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - extra);
        this._index = index;
        // Cell padding and embedded content can impose a higher minimum than the drag handle.
        const scrollLeft = figure.scrollLeft;
        this._display(this._widths.map(width => Math.min(width, MIN_WIDTH)));
        this._minima = headers.map((cell, i) => Math.min(this._widths[i], Math.ceil(cell.getBoundingClientRect().width)));
        this.restore();
        figure.scrollLeft = scrollLeft;
    }

    preview(delta: number) {
        const index = this._index;
        const widths = this._widths;
        let next: number[];
        const fill = this._original.indexOf('100%');
        if (index === widths.length - 1) {
            const minimum = this._minima.reduce((sum, width) => sum + width, 0);
            const target = Math.max(minimum, Math.min(this._total + delta, Math.max(this._total, this._available)));
            const snapToFill = delta > 0 && target === this._available && fill < 0;
            if (target === this._total && !snapToFill) {
                this.restore();
                return;
            }
            next = scaleSizes(widths, this._minima, this._total, target);
            this._previewFill = target === this._available ? (fill < 0 ? index : fill) : -1;
        }
        else {
            const left = widths[index];
            const right = widths[index + 1];
            const offset = Math.max(this._minima[index] - left, Math.min(delta, right - this._minima[index + 1]));
            if (!offset) {
                this.restore();
                return;
            }
            next = [...widths];
            next[index] = left + offset;
            next[index + 1] = right - offset;
            this._previewFill = fill;
        }
        this._display(next);
    }

    restore() {
        this._previewFill = -1;
        this._display(this._original);
    }

    commit(table: Table) {
        const preview = this._displayed;
        // Keep automatic and fill sizing wherever the browser can reproduce the drop with them.
        const sparse = preview.map((width, i) => {
            if (i === this._previewFill)
                return '100%';
            return width === this._widths[i] && this._original[i] !== '100%' ? this._original[i] : width;
        });
        if (sparse.some((width, i) => width !== preview[i])) {
            const edges = this._cells.map(([cell]) => cell.getBoundingClientRect().right);
            const matchesPreview = () => this._cells.every(([cell], i) => Math.abs(cell.getBoundingClientRect().right - edges[i]) < 1);
            this._display(sparse);
            if (!matchesPreview()) {
                if (this._previewFill >= 0) {
                    const filled = [...preview];
                    filled[this._previewFill] = '100%';
                    this._display(filled);
                }
                if (this._previewFill < 0 || !matchesPreview())
                    this._display(preview);
            }
        }
        const changes = new Map<number, ColumnWidth>();
        this._displayed.forEach((width, i) => {
            if (width !== this._original[i])
                changes.set(i, width);
        });
        this.restore();
        if (changes.size)
            table.setColumnWidths(changes);
    }

    private _display(widths: ColumnWidth[]) {
        if (widths.every((width, i) => width === this._displayed[i]))
            return;
        widths.forEach((width, i) => {
            if (width === this._displayed[i])
                return;
            for (const cell of this._cells[i])
                displayColumnWidth(cell, width);
        });
        this._displayed = widths;
        this._table.updateMinWidth(widths);
    }
}
