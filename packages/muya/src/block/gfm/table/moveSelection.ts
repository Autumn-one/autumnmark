import type { TSelectionState } from '../../../selection/types';
import type { TBlockPath } from '../../types';
import { SelectionType } from '../../../selection/types';

export function selectionAfterTableMove(selection: TSelectionState | null, tablePath: TBlockPath, axis: 'row' | 'column', from: number, to: number): TSelectionState | null {
    function moved(index: number) {
        if (index === from)
            return to;
        if (index >= Math.min(from, to) && index <= Math.max(from, to))
            return index + Math.sign(from - to);
        return index;
    }
    function inTable(path: readonly (string | number)[]) {
        return tablePath.every((part, i) => part === path[i]);
    }
    function movePath(path: readonly (string | number)[]) {
        const copy = [...path];
        const slot = tablePath.length + (axis === 'row' ? 1 : 3);
        if (inTable(path) && typeof path[slot] === 'number')
            copy[slot] = moved(path[slot]);
        return copy;
    }
    if (!selection)
        return null;
    switch (selection.kind) {
        case SelectionType.TEXT:
            return {
                ...selection,
                anchor: { ...selection.anchor, path: movePath(selection.anchor.path) },
                focus: { ...selection.focus, path: movePath(selection.focus.path) },
            };
        case SelectionType.IMAGE:
            return { ...selection, path: movePath(selection.path) };
        case SelectionType.TABLE:
            if (!inTable(selection.tablePath))
                return selection;
            return {
                ...selection,
                anchor: { ...selection.anchor, [axis]: moved(selection.anchor[axis]) },
                focus: { ...selection.focus, [axis]: moved(selection.focus[axis]) },
            };
    }
}
