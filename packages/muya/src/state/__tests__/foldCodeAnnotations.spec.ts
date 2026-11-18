// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { codeFenceLanguage, parseCodeFenceAnnotations, replaceCodeFenceLanguage } from '../../utils/codeFenceAnnotations';
import { getClipBoardHtml } from '../../utils/marked';
import { MarkdownToState } from '../markdownToState';
import { renderToStaticHTML } from '../renderToStaticHTML';
import ExportMarkdown from '../stateToMarkdown';

function render(markdown: string, renderHtml = renderToStaticHTML): HTMLDivElement {
    const container = document.createElement('div');
    container.innerHTML = renderHtml(markdown);
    return container;
}

const folded = [
    '<!-- fold -->',
    '',
    '### **Retry**',
    '',
    'Read the response header.',
    '',
    '```md',
    '<!-- /fold -->',
    '```',
    '',
    '<!-- fold open -->',
    '',
    '#### Extra information',
    '',
    'Retry body.',
    '',
    '<!-- /fold -->',
    '',
    '<!-- /fold -->',
    '',
    'Outside.',
    '',
].join('\n');

describe('fold block syntax', () => {
    it('preserves the heading, comments, and full body through Markdown save', () => {
        const state = new MarkdownToState().generate(folded);
        expect(new ExportMarkdown().generate(state)).toBe(folded);
    });

    it('exports nested disclosures with independent defaults and keeps headings for navigation', () => {
        const html = render(folded);
        const details = html.querySelectorAll<HTMLDetailsElement>('details.mu-export-fold');
        expect(details).toHaveLength(2);
        expect(details[0].open).toBe(false);
        expect(details[1].open).toBe(true);
        expect(details[0].querySelector('summary h3 strong')?.textContent).toBe('Retry');
        expect(details[1].querySelector('summary h4')?.textContent).toBe('Extra information');
        expect(details[0].querySelector('code')?.textContent).toContain('<!-- /fold -->');
        expect(html.querySelector(':scope > p')?.textContent).toBe('Outside.');
    });

    it('opens every fold in copy-as-HTML output', () => {
        const details = render(folded, getClipBoardHtml).querySelectorAll<HTMLDetailsElement>('details.mu-export-fold');
        expect([...details].map(element => element.open)).toEqual([true, true]);
    });

    it.each([
        '<!-- fold -->\n\n### Missing closing marker\n\nBody.',
        '<!-- fold -->\n\nMissing heading.\n\n<!-- /fold -->',
    ])('renders incomplete markup as ordinary Markdown', (markdown) => {
        expect(render(markdown).querySelector('details')).toBeNull();
        expect(render(markdown).querySelector('p')).not.toBeNull();
    });
});

describe('code fence annotations', () => {
    it('accepts titles containing spaces, range unions, and metadata without a language', () => {
        expect(parseCodeFenceAnnotations('ts title="request client.ts" {2-4, 3, 6-7,10}')).toEqual({
            title: 'request client.ts',
            ranges: [{ start: 2, end: 4 }, { start: 6, end: 7 }, { start: 10, end: 10 }],
        });
        expect(codeFenceLanguage('title="Example" {1}')).toBe('');
        expect(replaceCodeFenceLanguage('ts title="request.ts" {2-4}', 'js')).toBe('js title="request.ts" {2-4}');
    });

    it('treats malformed or unrelated info strings as ordinary metadata', () => {
        expect(parseCodeFenceAnnotations('js other="value {2, 4}" {4-2} {0} {2,broken}')).toEqual({ title: undefined, ranges: [] });
        expect(parseCodeFenceAnnotations('{example, listing1-name}').ranges).toEqual([]);
        expect(parseCodeFenceAnnotations('js {2-9007199254740991}').ranges)
            .toEqual([{ start: 2, end: 9007199254740991 }]);
    });

    it('preserves the raw info and empty lines when line numbers refer to them', () => {
        const source = '```js title="example.js" {1,3}\n\nconst x = 1\n\n```\n';
        const parsed = new MarkdownToState({ trimUnnecessaryCodeBlockEmptyLines: true }).generate(source);
        expect(new ExportMarkdown().generate(parsed)).toBe(source);
    });

    it('preserves syntax-colored multiline tokens and escapes the caption in HTML', () => {
        const markdown = '```js title="request & <response>.js" {2-3,5}\n/* note\nmore */\nconst x = 1\n\nconsole.log(x)\n```';
        const html = render(markdown);
        expect(html.querySelector('figcaption')?.textContent).toBe('request & <response>.js');
        expect(html.querySelector('figcaption response')).toBeNull();
        expect(html.querySelector('code')?.textContent).toBe('/* note\nmore */\nconst x = 1\n\nconsole.log(x)\n');
        expect([...html.querySelectorAll('.mu-export-code-highlight')].map(node => node.textContent))
            .toEqual(['more */\n', 'const x = 1\n', 'console.log(x)\n']);
        expect(html.querySelector('.mu-export-code-highlight .token.comment')?.textContent).toBe('more */');
    });

    it('keeps unrelated plain fences on the existing render path', () => {
        expect(render('```text\nordinary\n```').querySelector('figure')).toBeNull();
        expect(render('```mermaid title="Diagram" {1}\nflowchart TD\n```').querySelector('code.language-mermaid')).not.toBeNull();
    });
});
