import type Table from '.';
import type { TTableColumnWidth } from '../../../state/types';
import type TableBodyCell from './cell';
import { BLOCK_DOM_PROPERTY } from '../../../config';
import { displayColumnWidth } from './cell';

interface IEdge {
    axis: 'column' | 'row';
    cell: TableBodyCell;
}

interface IResizeGesture {
    edge: IEdge;
    pointer: number;
    start: number;
    extent: number;
    reservedWidth: number;
    original?: TTableColumnWidth;
    size?: TTableColumnWidth;
    targets: HTMLElement[];
    previousFill: HTMLElement[];
}

function reservedColumnWidth(grid: HTMLTableElement, index: number) {
    const cells = Array.from(grid.rows[0].cells);
    const widths = cells.map(cell => cell.getBoundingClientRect().width);
    const previousWidth = grid.style.width;
    // Automatic columns may wrap down to their intrinsic minimum. Keep manually sized neighbours at their visible width.
    grid.style.width = 'min-content';
    const minimum = grid.getBoundingClientRect().width;
    const minima = cells.map(cell => cell.getBoundingClientRect().width);
    grid.style.width = previousWidth;
    let reserved = minimum - minima[index];
    for (const [i, cell] of cells.entries()) {
        if (i !== index && cell.style.getPropertyValue('--mu-cell-width'))
            reserved += widths[i] - minima[i];
    }
    const style = getComputedStyle(grid.parentElement!);
    return reserved + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
}

function edgeAt(event: MouseEvent): IEdge | undefined {
    const td = event.target instanceof Element ? event.target.closest('td.mu-table-cell') : null;
    const cell = td?.[BLOCK_DOM_PROPERTY] as TableBodyCell | undefined;
    if (!cell || !td)
        return;
    const rect = td.getBoundingClientRect();
    if (rect.right - event.clientX <= 4)
        return { axis: 'column', cell };
    if (event.clientX - rect.left <= 4 && cell.prev)
        return { axis: 'column', cell: cell.prev as TableBodyCell };
    if (rect.bottom - event.clientY <= 4)
        return { axis: 'row', cell };
    if (event.clientY - rect.top <= 4 && cell.row.prev) {
        const above = cell.table.cellAt(cell.rowOffset - 1, cell.columnOffset);
        if (above)
            return { axis: 'row', cell: above };
    }
}

export function attachTableResize(table: Table) {
    const figure = table.domNode!;
    const guide = document.createElement('div');
    guide.className = 'mu-table-guide mu-copy-remove mu-output-remove';
    guide.contentEditable = 'false';
    let drag: IResizeGesture | undefined;

    function hideGuide() {
        guide.remove();
        delete figure.dataset.resizeAxis;
    }

    function showGuide({ axis, cell }: IEdge) {
        const bounds = figure.getBoundingClientRect();
        const grid = table.firstChild!.domNode!.getBoundingClientRect();
        const box = cell.domNode!.getBoundingClientRect();
        const column = axis === 'column';
        Object.assign(guide.style, {
            left: `${(column ? box.right - 2 : grid.left) - bounds.left + figure.scrollLeft}px`,
            top: `${(column ? grid.top : box.bottom) - bounds.top + figure.scrollTop}px`,
            width: column ? '2px' : `${grid.width}px`,
            height: column ? `${grid.height}px` : '2px',
        });
        if (!guide.parentNode)
            figure.append(guide);
        figure.dataset.resizeAxis = axis;
    }

    function preview(size?: TTableColumnWidth) {
        const { edge, targets, previousFill } = drag!;
        if (edge.axis === 'column') {
            for (const cell of previousFill)
                cell.classList.toggle('mu-table-cell-fill', size !== '100%');
            for (const cell of targets)
                displayColumnWidth(cell, size);
        }
        else {
            targets[0].style.height = size ? `${size}px` : '';
        }
    }

    function update(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer)
            return;
        const column = drag.edge.axis === 'column';
        const delta = (column ? event.clientX : event.clientY) - drag.start;
        const start = Math.round(drag.extent);
        let pixels = Math.max(column ? 36 : 1, Math.round(drag.extent + delta));
        let fill = false;
        if (column) {
            const available = Math.floor(figure.clientWidth - drag.reservedWidth);
            fill = delta > 0 && pixels >= available && available >= start - 1;
            // A table wider than the viewport at its intrinsic minimum can still be shrunk.
            pixels = Math.min(pixels, Math.max(start, available));
        }
        drag.size = delta && pixels !== start ? pixels : drag.original;
        if (fill)
            drag.size = '100%';
        preview(drag.size);
        showGuide(drag.edge);
    }

    function finish(event: PointerEvent, commit: boolean) {
        if (!drag || event.pointerId !== drag.pointer)
            return;
        const { edge, original, size, pointer } = drag;
        preview(original);
        drag = undefined;
        hideGuide();
        const capture = edge.cell.domNode!;
        if (capture.hasPointerCapture(pointer))
            capture.releasePointerCapture(pointer);
        if (!commit || original === size || !table.muya.isBlockInDocument(edge.cell))
            return;
        if (edge.axis === 'column')
            table.setSize('column', edge.cell.columnOffset, size);
        else if (typeof size === 'number')
            table.setSize('row', edge.cell.rowOffset, size);
    }

    figure.addEventListener('pointermove', (event) => {
        if (drag) {
            update(event);
            return;
        }
        const edge = table.muya.canMutate && !event.buttons ? edgeAt(event) : undefined;
        if (edge)
            showGuide(edge);
        else
            hideGuide();
    });
    figure.addEventListener('pointerleave', () => {
        if (!drag)
            hideGuide();
    });
    figure.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !event.isPrimary || !table.muya.canMutate || drag)
            return;
        const edge = edgeAt(event);
        if (!edge)
            return;
        event.preventDefault();
        const { cell, axis } = edge;
        const column = axis === 'column';
        const box = cell.domNode!.getBoundingClientRect();
        const original = column ? cell.meta.width : cell.row.minHeight;
        const grid = table.firstChild!.domNode as HTMLTableElement;
        const index = cell.columnOffset;
        drag = {
            edge,
            original,
            size: original,
            pointer: event.pointerId,
            start: column ? event.clientX : event.clientY,
            extent: column ? box.width : box.height,
            reservedWidth: column ? reservedColumnWidth(grid, index) : 0,
            targets: column ? Array.from(grid.rows, row => row.cells[index]) : [cell.row.domNode!],
            previousFill: column && original !== '100%' ? Array.from(grid.querySelectorAll('.mu-table-cell-fill')) : [],
        };
        showGuide(edge);
        cell.domNode!.setPointerCapture(event.pointerId);
    });
    figure.addEventListener('pointerup', (event) => {
        update(event);
        finish(event, true);
    });
    figure.addEventListener('lostpointercapture', event => finish(event, false));
    figure.addEventListener('pointercancel', event => finish(event, false));
    figure.addEventListener('dblclick', (event) => {
        if (!table.muya.canMutate)
            return;
        const edge = edgeAt(event);
        if (!edge)
            return;
        event.preventDefault();
        event.stopPropagation();
        const { cell, axis } = edge;
        if (axis === 'column' && cell.meta.width)
            table.setSize(axis, cell.columnOffset);
        else if (axis === 'row' && cell.row.minHeight)
            table.setSize(axis, cell.rowOffset);
    });
}
