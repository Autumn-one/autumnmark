// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import { renderToStaticHTML } from '../renderToStaticHTML';
import ExportMarkdown from '../stateToMarkdown';

const parser = new MarkdownToState({ frontMatter: false });
const printer = new ExportMarkdown();
const source = '<!-- tabs -->\n\n#### | **Alpha**\n\nFirst body.\n\n#### \\| Beta\n\nSecond body.\n\n#### Ordinary\n\nStill in Beta.\n\n<!-- /tabs -->\n';

describe('content tabs persistence and export', () => {
    it('retains ordinary Markdown state and both marker spellings when saved', () => {
        const state = parser.generate(source);
        expect(state.map(block => block.name)).toEqual(['html-block', 'atx-heading', 'paragraph', 'atx-heading', 'paragraph', 'atx-heading', 'paragraph', 'html-block']);
        expect(printer.generate(state)).toBe(source);
        expect(parser.generate(printer.generate(state))).toEqual(state);
    });

    it('exports every panel and the ordinary heading in source order', () => {
        const html = renderToStaticHTML(source);
        const container = document.createElement('div');
        container.innerHTML = html;
        expect([...container.querySelectorAll('h4')].map(node => node.textContent)).toEqual(['Alpha', 'Beta', 'Ordinary']);
        expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['First body.', 'Second body.', 'Still in Beta.']);
        expect(container.querySelector('h4 strong')?.textContent).toBe('Alpha');
    });

    it.each([
        '#### | Outside\n',
        '<!-- tabs -->\n\n#### | Unclosed\n\nBody\n',
        '<!-- tabs -->\n\n#### || Ordinary\n\n<!-- /tabs -->\n',
    ])('falls back without removing a literal marker: %j', (markdown) => {
        const container = document.createElement('div');
        container.innerHTML = renderToStaticHTML(markdown);
        expect(container.querySelector('h4')?.textContent).toContain('|');
    });

    it('ignores nested headings and closing markers inside code', () => {
        const markdown = '<!-- tabs -->\n\n#### | Alpha\n\n> #### | Quoted\n\n- #### | Listed\n\n```md\n<!-- /tabs -->\n#### | Code\n```\n\n#### | Beta\n\nBody\n\n<!-- /tabs -->';
        const container = document.createElement('div');
        container.innerHTML = renderToStaticHTML(markdown);
        expect([...container.querySelectorAll(':scope > h4')].map(node => node.textContent)).toEqual(['Alpha', 'Beta']);
        expect(container.querySelector('blockquote h4')?.textContent).toBe('| Quoted');
        expect(container.querySelector('li h4')?.textContent).toBe('| Listed');
        expect(container.querySelector('code')?.textContent).toContain('<!-- /tabs -->');
    });

    it('resolves reference links in labels without discarding their definitions', () => {
        const html = renderToStaticHTML('<!-- tabs -->\n\n## | [Alpha][ref]\n\nBody\n\n<!-- /tabs -->\n\n[ref]: https://example.com');
        expect(html).toContain('<a href="https://example.com">Alpha</a>');
    });
});
