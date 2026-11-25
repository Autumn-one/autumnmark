import type { MarkedExtension, Tokens } from 'marked';
import type { TTableColumnWidth } from '../../../state/types';
import { Renderer } from 'marked';

export interface ISizedTableCell extends Tokens.TableCell {
    width?: TTableColumnWidth;
    minHeight?: number;
}

const MARKER = /^ {0,3}<!-- table-layout: ([^\r\n]*?) -->[ \t]*\r?\n(?:[ \t]*\r?\n)*/;
const FIELD = /^(col-widths|row-min-heights)="([^"]+)"$/;
const ENTRY = /^([1-9]\d*):([1-9]\d*|100%)$/;

function dimensions(fields: string) {
    const widths = new Map<number, TTableColumnWidth>();
    const heights = new Map<number, number>();
    for (const field of fields.split(/[ \t]+/)) {
        const match = FIELD.exec(field);
        if (!match)
            return;
        const column = match[1] === 'col-widths';
        const sizes = column ? widths : heights;
        if (sizes.size)
            return;
        for (const pair of match[2].split(',')) {
            const entry = ENTRY.exec(pair);
            if (!entry)
                return;
            const index = Number(entry[1]);
            if (!Number.isSafeInteger(index) || sizes.has(index))
                return;
            if (entry[2] === '100%') {
                if (!column || [...widths.values()].includes('100%'))
                    return;
                widths.set(index, '100%');
            }
            else {
                const pixels = Number(entry[2]);
                if (!Number.isSafeInteger(pixels))
                    return;
                sizes.set(index, pixels);
            }
        }
    }
    return { widths, heights };
}

export default function tableLayoutExtension(): MarkedExtension {
    return {
        extensions: [{
            name: 'sizedTable',
            level: 'block',
            tokenizer(src) {
                const marker = MARKER.exec(src);
                if (!marker)
                    return;
                const layout = dimensions(marker[1]);
                if (!layout)
                    return;
                const table = this.lexer.options.tokenizer?.table(src.slice(marker[0].length));
                if (!table)
                    return;
                table.raw = marker[0] + table.raw;
                [table.header, ...table.rows].forEach((row, r) => {
                    row.forEach((cell: ISizedTableCell, c) => {
                        cell.width = layout.widths.get(c + 1);
                        cell.minHeight = layout.heights.get(r + 1);
                    });
                });
                return table;
            },
        }],
        renderer: {
            table(token) {
                const header: ISizedTableCell[] = token.header;
                if (!header.some(cell => cell.width === '100%'))
                    return false;
                const columns = header.map(cell => cell.width ? '<col>' : '<col style="width:1px">').join('');
                const html = Renderer.prototype.table.call(this, token);
                return html.replace('<table>', `<table style="width:100%"><colgroup>${columns}</colgroup>`);
            },
            tablecell(cell: ISizedTableCell) {
                if (typeof cell.width !== 'number' && !cell.minHeight)
                    return false;
                const styles: string[] = [];
                if (typeof cell.width === 'number') {
                    const width = `${cell.width}px`;
                    styles.push('box-sizing:border-box', `width:${width}`, `max-width:${width}`, 'overflow-wrap:anywhere');
                }
                if (cell.minHeight)
                    styles.push(`height:${cell.minHeight}px`);
                const html = Renderer.prototype.tablecell.call(this, cell);
                return html.replace(/^<(td|th)/, `<$1 style="${styles.join(';')}"`);
            },
        },
    };
}
