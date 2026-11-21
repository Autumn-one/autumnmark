import type Table from '.';
import type { TTableColumnWidth } from '../../../state/types';
import type TableBodyCell from './cell';
import { BLOCK_DOM_PROPERTY } from '../../../config';
import { ColumnResize } from './columnResize';

interface IEdge {
    axis: 'column' | 'row';
    cell: TableBodyCell;
}

interface IResizeGesture {
    edge: IEdge;
    pointer: number;
    start: number;
    extent: number;
    column?: ColumnResize;
    original?: TTableColumnWidth;
    size?: TTableColumnWidth;
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
        const { column, edge } = drag!;
        if (column)
            column.preview(size);
        else
            edge.cell.row.domNode!.style.height = size ? `${size}px` : '';
    }

    function update(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer)
            return;
        const column = drag.edge.axis === 'column';
        const delta = (column ? event.clientX : event.clientY) - drag.start;
        const start = Math.round(drag.extent);
        let pixels = Math.max(column ? 36 : 1, Math.round(drag.extent + delta));
        let fill = false;
        if (drag.column) {
            const available = Math.floor(figure.clientWidth - drag.column.reservedWidth);
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
        const changed = commit && original !== size && table.muya.isBlockInDocument(edge.cell);
        const anchoredWidths = changed ? drag.column?.widthsForCommit() : undefined;
        preview(original);
        drag = undefined;
        hideGuide();
        const capture = edge.cell.domNode!;
        if (capture.hasPointerCapture(pointer))
            capture.releasePointerCapture(pointer);
        if (!changed)
            return;
        if (edge.axis === 'column')
            table.setSize('column', edge.cell.columnOffset, size, anchoredWidths);
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
            column: column ? new ColumnResize(grid, index) : undefined,
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
