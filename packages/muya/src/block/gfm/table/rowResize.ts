import type Table from '.';
import type TableRow from './row';
import type TableInner from './table';
import { scaleSizes } from './resizeDimensions';

export class RowResize {
    private _rows: TableRow[];
    private _first: number;
    private _wholeTable: boolean;
    private _heights: number[];
    private _minima: number[];
    private _original: (number | undefined)[];
    private _displayed: (number | undefined)[];

    constructor(table: TableInner, index: number) {
        this._wholeTable = index === table.children.length - 1;
        this._first = this._wholeTable ? 0 : index;
        this._rows = this._wholeTable
            ? table.children.map(row => row)
            : [table.children.find(index)!, table.children.find(index + 1)!];
        this._original = this._rows.map(row => row.minHeight);
        this._displayed = this._original;
        this._heights = this._measure();
        this._minima = this._heights;
        if (this._original.some(height => height !== undefined)) {
            // Hold the figure in place while measuring wrapped content at its current column width.
            const figure = table.domNode!.parentElement!;
            const minHeight = figure.style.minHeight;
            figure.style.minHeight = getComputedStyle(figure).height;
            this._display(this._rows.map(() => undefined));
            this._minima = this._measure();
            this.restore();
            figure.style.minHeight = minHeight;
        }
    }

    preview(delta: number) {
        let next: number[];
        if (this._wholeTable) {
            const total = this._heights.reduce((sum, height) => sum + height, 0);
            const minimum = this._minima.reduce((sum, height) => sum + height, 0);
            const target = Math.max(minimum, total + delta);
            if (target === total) {
                this.restore();
                return;
            }
            next = scaleSizes(this._heights, this._minima, total, target);
        }
        else {
            const [above, below] = this._heights;
            const offset = Math.max(this._minima[0] - above, Math.min(delta, below - this._minima[1]));
            if (!offset) {
                this.restore();
                return;
            }
            next = [above + offset, below - offset];
        }
        this._display(next.map((height, i) => {
            if (height === this._heights[i])
                return this._original[i];
            return height <= this._minima[i] ? undefined : Math.round(height);
        }));
    }

    restore() {
        this._display(this._original);
    }

    commit(table: Table) {
        const changes = new Map<number, number | undefined>();
        this._displayed.forEach((height, i) => {
            if (height !== this._original[i])
                changes.set(this._first + i, height);
        });
        this.restore();
        if (changes.size)
            table.setRowHeights(changes);
    }

    private _measure() {
        return this._rows.map(row => row.domNode!.getBoundingClientRect().height);
    }

    private _display(heights: (number | undefined)[]) {
        heights.forEach((height, i) => {
            if (height !== this._displayed[i])
                this._rows[i].domNode!.style.height = height === undefined ? '' : `${height}px`;
        });
        this._displayed = heights;
    }
}
