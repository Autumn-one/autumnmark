// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getClipBoardHtml } from '../../utils/marked';
import { MarkdownToState } from '../markdownToState';
import { renderToStaticHTML } from '../renderToStaticHTML';
import ExportMarkdown from '../stateToMarkdown';

const marker = '<!-- table-layout: col-widths="2:144" row-min-heights="2:64" -->';
const table = '| A | B |\n| --- | ---: |\n| *a* | b |';
const source = [marker, '', table].join('\n');

describe('table layout annotations', () => {
    it.each([source, source.split('\n').map(line => `> ${line}`).join('\n'), `1. item\n\n${source.split('\n').map(line => `   ${line}`).join('\n')}`])('round-trips dimensions with their table', (markdown) => {
        const parser = new MarkdownToState();
        const state = parser.generate(markdown);
        const saved = new ExportMarkdown().generate(state);
        expect(saved).toContain(marker);
        expect(parser.generate(saved)).toEqual(state);
    });

    it.each([renderToStaticHTML, getClipBoardHtml])('exports dimensions, formatting and alignment together', (render) => {
        const host = document.createElement('div');
        host.innerHTML = render(source);
        const grid = host.querySelector('table')!;
        expect(grid.rows[0].cells[0].style.width).toBe('');
        expect(grid.rows[0].cells[1].style.width).toBe('144px');
        expect(grid.rows[0].cells[1].style.minWidth).toBe('');
        expect(grid.rows[1].cells[1].style.height).toBe('64px');
        expect(grid.rows[1].cells[0].querySelector('em')?.textContent).toBe('a');
        expect(grid.rows[0].cells[1].getAttribute('align')).toBe('right');
    });

    it('round-trips a fill column and exports a full-width table', () => {
        const full = source.replace('2:144', '2:100%');
        const state = new MarkdownToState().generate(full);
        expect(new ExportMarkdown().generate(state)).toContain('col-widths="2:100%" row-min-heights="2:64"');
        for (const render of [renderToStaticHTML, getClipBoardHtml]) {
            const host = document.createElement('div');
            host.innerHTML = render(full);
            const grid = host.querySelector('table')!;
            expect(grid.style.width).toBe('100%');
            expect(grid.querySelectorAll('col')).toHaveLength(2);
            expect(grid.rows[1].cells[1].style.height).toBe('64px');
        }
    });

    it.each([marker.replace('2:144', 'malformed'), marker.replace('2:64', '2:100%'), marker.replace('2:144', '2:50%'), marker.replace('2:144', '1:100%,2:100%'), '<!-- ordinary -->'])('preserves unrelated or malformed comments', (comment) => {
        const state = new MarkdownToState().generate(`${comment}\n\n${table}`);
        expect(state.map(node => node.name)).toEqual(['html-block', 'table']);
        expect(new ExportMarkdown().generate(state)).toContain(comment);
    });
    it('requires the marker to immediately precede its table', () => {
        const state = new MarkdownToState().generate(`${marker}\n\ntext\n\n${table}`);
        expect(state.map(node => node.name)).toEqual(['html-block', 'paragraph', 'table']);
    });
});
