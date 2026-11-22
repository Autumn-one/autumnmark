import type Table from '../../block/gfm/table';
import type TableBodyCell from '../../block/gfm/table/cell';
import type { Muya } from '../../muya';
import { BOTTOM_RESIZE_MARGIN } from '../../block/gfm/table/resizeDimensions';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { isMouseEvent, throttle } from '../../utils';
import BaseFloat from '../baseFloat';
import './index.css';

type BarType = 'bottom' | 'right';

const OFFSET = 20;

interface IDrag {
    cell: TableBodyCell;
    table: Table;
    bar: BarType;
    pointer: number;
    start: number;
    from: number;
    to: number;
    moved: boolean;
    cells: HTMLTableCellElement[];
    bounds: DOMRect[];
    guide: HTMLElement;
}

export function getAllTableCells(table: Table) {
    const grid = table.firstChild!.domNode as HTMLTableElement;
    return Array.from(grid.rows, row => Array.from(row.cells));
}

export function getIndex(bar: BarType, cell: TableBodyCell) {
    return bar === 'bottom' ? cell.columnOffset : cell.rowOffset;
}

function optionsFor(bar: BarType) {
    const mainAxis = bar === 'bottom' ? BOTTOM_RESIZE_MARGIN : 0;
    return { placement: bar, offsetOptions: { mainAxis, crossAxis: 0, alignmentAxis: 0 }, showArrow: false };
}

export class TableDragBar extends BaseFloat {
    static pluginName = 'tableDragBar';
    private _block: TableBodyCell | null = null;
    private _bar: BarType = 'bottom';
    private _drag?: IDrag;

    constructor(muya: Muya, options = {}) {
        super(muya, 'mu-table-drag-bar', { ...optionsFor('bottom'), ...options });
        this.floatBox!.classList.add('mu-table-drag-container');
        this.listen();
    }

    override listen() {
        super.listen();
        const { eventCenter } = this.muya;
        const handle = this.container!;
        const cellAt = (x: number, y: number) => {
            for (const element of document.elementsFromPoint(x, y)) {
                const block = element[BLOCK_DOM_PROPERTY];
                if (block?.blockName === 'table.cell' && block.muya === this.muya)
                    return block as TableBodyCell;
            }
        };
        const hover = throttle((event: Event) => {
            if (!isMouseEvent(event) || this._drag)
                return;
            if (event.target instanceof Node && handle.contains(event.target))
                return;
            const { x, y } = event;
            if (!event.buttons && this.muya.canMutate && !cellAt(x, y)) {
                const above = cellAt(x, y - OFFSET);
                const cell = above ?? cellAt(x - OFFSET, y);
                if (cell) {
                    this._block = cell;
                    this._bar = above ? 'bottom' : 'right';
                    this.options = optionsFor(this._bar);
                    handle.dataset.drag = this._bar;
                    this.show(cell.domNode!);
                    return;
                }
            }
            this.hide();
        });
        eventCenter.attachDOMEvent(document.body, 'mousemove', hover);
        handle.addEventListener('pointerdown', (event) => {
            const cell = this._block;
            if (!cell || this._drag || !event.isPrimary || event.button !== 0 || !this.muya.canMutate || !this.muya.isBlockInDocument(cell))
                return;
            event.preventDefault();
            event.stopPropagation();
            const table = cell.table;
            const rows = getAllTableCells(table);
            const bar = this._bar;
            const column = bar === 'bottom';
            const from = getIndex(bar, cell);
            const guide = document.createElement('div');
            guide.className = 'mu-table-guide mu-copy-remove mu-output-remove';
            guide.contentEditable = 'false';
            this._drag = {
                cell,
                table,
                bar,
                from,
                to: from,
                pointer: event.pointerId,
                moved: false,
                guide,
                start: column ? event.clientX : event.clientY,
                cells: column ? rows.map(row => row[from]) : rows[from],
                bounds: (column ? rows[0] : rows.map(row => row[0])).map(td => td.getBoundingClientRect()),
            };
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', event => this._move(event));
        handle.addEventListener('pointerup', (event) => {
            const drag = this._drag;
            if (!drag || drag.pointer !== event.pointerId)
                return;
            this._move(event);
            this._clear();
            if (!this.muya.canMutate || !this.muya.isBlockInDocument(drag.cell))
                return;
            if (!drag.moved) {
                eventCenter.emit('muya-table-bar', {
                    reference: { getBoundingClientRect: () => handle.getBoundingClientRect() },
                    tableInfo: { barType: drag.bar },
                    block: drag.cell,
                });
            }
            else if (drag.from !== drag.to && getIndex(drag.bar, drag.cell) === drag.from) {
                drag.table.move(drag.bar === 'bottom' ? 'column' : 'row', drag.from, drag.to);
                this.hide();
            }
        });
        handle.addEventListener('lostpointercapture', () => this._clear());
        handle.addEventListener('pointercancel', () => this._clear());
    }

    private _move(event: PointerEvent) {
        const drag = this._drag;
        if (!drag || drag.pointer !== event.pointerId)
            return;
        const column = drag.bar === 'bottom';
        const point = column ? event.clientX : event.clientY;
        const delta = point - drag.start;
        if (!drag.moved && Math.abs(delta) < 4)
            return;
        drag.moved = true;
        if (!column && drag.from === 0)
            return;

        const before = drag.bounds.filter((rect, i) => i !== drag.from && point > (column ? rect.left + rect.width / 2 : rect.top + rect.height / 2));
        drag.to = Math.max(column ? 0 : 1, before.length);
        for (const cell of drag.cells) {
            cell.classList.add('mu-drag-cell');
            cell.style.transform = column ? `translateX(${delta}px)` : `translateY(${delta}px)`;
        }
        const grid = drag.table.firstChild!.domNode!.getBoundingClientRect();
        const figure = drag.table.domNode!;
        const origin = figure.getBoundingClientRect();
        const target = drag.bounds[drag.to];
        const forward = drag.to > drag.from;
        const x = column ? (forward ? target.right : target.left) : grid.left;
        const y = column ? grid.top : (forward ? target.bottom : target.top);
        Object.assign(drag.guide.style, {
            left: `${x - origin.left + figure.scrollLeft}px`,
            top: `${y - origin.top + figure.scrollTop}px`,
            width: column ? '2px' : `${grid.width}px`,
            height: column ? `${grid.height}px` : '2px',
        });
        if (!drag.guide.parentNode)
            figure.append(drag.guide);
    }

    private _clear() {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = undefined;
        if (this.container?.hasPointerCapture(drag.pointer))
            this.container.releasePointerCapture(drag.pointer);
        drag.guide.remove();
        for (const cell of drag.cells) {
            cell.classList.remove('mu-drag-cell');
            cell.style.removeProperty('transform');
        }
    }

    override destroy() {
        this._clear();
        super.destroy();
    }
}
