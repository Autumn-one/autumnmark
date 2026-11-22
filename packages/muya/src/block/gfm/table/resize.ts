import type Table from '.';
import type TableBodyCell from './cell';
import type TableInner from './table';
import { BLOCK_DOM_PROPERTY } from '../../../config';
import { ColumnResize } from './columnResize';
import { BOTTOM_RESIZE_MARGIN } from './resizeDimensions';
import { RowResize } from './rowResize';

interface IEdge {
    axis: 'column' | 'row';
    cell: TableBodyCell;
}

interface IResizeGesture {
    edge: IEdge;
    pointer: number;
    start: number;
    sizing: ColumnResize | RowResize;
}

function edgeAt(event: MouseEvent, table: Table): IEdge | undefined {
    const td = event.target instanceof Element ? event.target.closest('td.mu-table-cell') : null;
    if (!td && event.target === table.domNode) {
        const bounds = table.firstChild!.domNode!.getBoundingClientRect();
        if (event.clientY >= bounds.bottom && event.clientY < bounds.bottom + BOTTOM_RESIZE_MARGIN
            && event.clientX >= bounds.left && event.clientX <= bounds.right) {
            const last = table.cellAt(table.rowCount - 1, 0);
            if (last)
                return { axis: 'row', cell: last };
        }
    }
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

    function update(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer)
            return;
        const position = drag.edge.axis === 'column' ? event.clientX : event.clientY;
        drag.sizing.preview(Math.round(position - drag.start));
        showGuide(drag.edge);
    }

    function finish(event: PointerEvent, commit: boolean) {
        if (!drag || event.pointerId !== drag.pointer)
            return;
        const { edge, sizing, pointer } = drag;
        drag = undefined;
        hideGuide();
        const capture = edge.cell.domNode!;
        if (capture.hasPointerCapture(pointer))
            capture.releasePointerCapture(pointer);
        if (commit && table.muya.canMutate && table.muya.isBlockInDocument(edge.cell))
            sizing.commit(table);
        else
            sizing.restore();
    }

    figure.addEventListener('pointermove', (event) => {
        if (drag) {
            update(event);
            return;
        }
        const edge = table.muya.canMutate && !event.buttons ? edgeAt(event, table) : undefined;
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
        const edge = edgeAt(event, table);
        if (!edge)
            return;
        event.preventDefault();
        const { cell, axis } = edge;
        const column = axis === 'column';
        const inner = table.firstChild as TableInner;
        drag = {
            edge,
            pointer: event.pointerId,
            start: column ? event.clientX : event.clientY,
            sizing: column ? new ColumnResize(inner, cell.columnOffset) : new RowResize(inner, cell.rowOffset),
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
        const edge = edgeAt(event, table);
        if (!edge)
            return;
        event.preventDefault();
        event.stopPropagation();
        const { cell, axis } = edge;
        if (axis === 'column' && cell.meta.width)
            table.setColumnWidths(new Map([[cell.columnOffset, undefined]]));
        else if (axis === 'row' && cell.row.minHeight)
            table.setRowHeights(new Map([[cell.rowOffset, undefined]]));
    });
}
