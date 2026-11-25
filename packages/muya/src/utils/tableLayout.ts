import type { ITableState, TTableColumnWidth } from '../state/types';

export function tableLayoutComment(table: ITableState): string {
    const fields: string[] = [];
    function add(name: string, values: (TTableColumnWidth | undefined)[]) {
        const pairs = values.flatMap((size, index) => size ? [`${index + 1}:${size}`] : []);
        if (pairs.length)
            fields.push(`${name}="${pairs.join(',')}"`);
    }
    add('col-widths', table.children[0].children.map(cell => cell.meta.width));
    add('row-min-heights', table.children.map(row => row.minHeight));
    return fields.length ? `<!-- table-layout: ${fields.join(' ')} -->` : '';
}
