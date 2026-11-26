// @vitest-environment jsdom
import type { Muya } from '../../muya';
import { describe, expect, it } from 'vitest';
import { encodeInlineDrawing } from '../../utils/diagram/drawingData';
import { drawingPreviewExpansionEdits } from '../../utils/drawingLayout';
import { getClipBoardHtml } from '../../utils/marked';
import { MarkdownToHtml } from '../markdownToHtml';
import { MarkdownToState } from '../markdownToState';
import { renderToStaticHTML } from '../renderToStaticHTML';
import ExportMarkdown from '../stateToMarkdown';

const SAMPLE_SCENE = '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}';
const INLINE_DRAWING = `![Embedded drawing](${encodeInlineDrawing(SAMPLE_SCENE)})`;
const LINKED_DRAWING = '![Architecture](diagram/arch.excalidraw)';
const FENCED_DRAWING = `\`\`\`excalidraw\n${SAMPLE_SCENE}\n\`\`\``;
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';

describe('drawing layout annotations', () => {
    it.each([
        ['inline drawing (px)', `<!-- drawing-layout: width="480" -->\n\n${INLINE_DRAWING}`],
        ['inline drawing (100%)', `<!-- drawing-layout: width="100%" -->\n\n${INLINE_DRAWING}`],
        ['fenced drawing (px)', `<!-- drawing-layout: width="360" -->\n\n${FENCED_DRAWING}`],
        ['fenced drawing (100%)', `<!-- drawing-layout: width="100%" -->\n\n${FENCED_DRAWING}`],
        ['linked drawing (px)', `<!-- drawing-layout: width="420" -->\n\n${LINKED_DRAWING}`],
        ['multi-drawing paragraph', `<!-- drawing-layout: widths="1:320,2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`],
        ['second drawing only', `<!-- drawing-layout: widths="2:280" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`],
    ])('round-trips %s at top-level, in blockquote, and in list item', (_label, block) => {
        const parser = new MarkdownToState();
        const exporter = new ExportMarkdown();
        const variants = [
            block,
            block.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n'),
            `1. item\n\n${block.split('\n').map(line => (line ? `   ${line}` : '')).join('\n')}`,
        ];
        for (const markdown of variants) {
            const state = parser.generate(markdown);
            const saved = exporter.generate(state);
            const expectedComment = block.split('\n')[0];
            expect(saved).toContain(expectedComment);
            expect(parser.generate(saved)).toEqual(state);
        }
    });

    it('accepts comments without an intervening blank line', () => {
        const parser = new MarkdownToState();
        const state = parser.generate(`<!-- drawing-layout: width="520" -->\n${INLINE_DRAWING}`);
        expect(state).toHaveLength(1);
        expect(state[0]).toMatchObject({
            name: 'paragraph',
            meta: { drawingWidths: { 1: 520 } },
        });
    });

    it.each([
        '<!-- drawing-layout: width="0" -->',
        '<!-- drawing-layout: width="-10" -->',
        '<!-- drawing-layout: width="50%" -->',
        '<!-- drawing-layout: width="abc" -->',
        '<!-- drawing-layout: widths="1:200,1:300" -->',
        '<!-- drawing-layout: width="200" widths="2:300" -->',
        '<!-- ordinary -->',
    ])('preserves malformed or unrelated comment %s as html-block', (comment) => {
        const parser = new MarkdownToState();
        const state = parser.generate(`${comment}\n\n${INLINE_DRAWING}`);
        expect(state.map(node => node.name)).toEqual(['html-block', 'paragraph']);
        expect(new ExportMarkdown().generate(state)).toContain(comment);
    });

    it('preserves comments not immediately preceding a drawing or preceding a non-excalidraw fence', () => {
        const parser = new MarkdownToState();
        const comment = '<!-- drawing-layout: width="480" -->';

        const plainParagraph = parser.generate(`${comment}\n\nJust plain text`);
        expect(plainParagraph.map(node => node.name)).toEqual(['html-block', 'paragraph']);

        const separated = parser.generate(`${comment}\n\nText\n\n${INLINE_DRAWING}`);
        expect(separated.map(node => node.name)).toEqual(['html-block', 'paragraph', 'paragraph']);

        const jsFence = parser.generate(`${comment}\n\n\`\`\`js\nconst x = 1\n\`\`\``);
        expect(jsFence.map(node => node.name)).toEqual(['html-block', 'code-block']);

        const indexedOnFence = parser.generate(`<!-- drawing-layout: widths="1:480" -->\n\n${FENCED_DRAWING}`);
        expect(indexedOnFence.map(node => node.name)).toEqual(['html-block', 'diagram']);
    });

    it('omits stale comment when drawings are removed from paragraph text', () => {
        const saved = new ExportMarkdown().generate([{
            name: 'paragraph',
            meta: { drawingWidths: { 1: 480 } },
            text: 'No drawing left',
        }]);
        expect(saved).toBe('No drawing left\n');
    });

    it.each([renderToStaticHTML, getClipBoardHtml])('exports unexpanded paragraph drawing widths strictly without guessing on plain PNG data URLs', (render) => {
        const pixelSource = `<!-- drawing-layout: width="480" -->\n\n![pic](a.png) ${INLINE_DRAWING}`;
        const host = document.createElement('div');
        host.innerHTML = render(pixelSource);
        const imgs = host.querySelectorAll('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].style.width).toBe('');
        expect(imgs[1].style.width).toBe('480px');
        expect(imgs[1].style.maxWidth).toBe('100%');
        expect(imgs[1].style.height).toBe('auto');

        // Plain PNG data URLs are not drawings; the comment must not guess and style them.
        const plainPng = `<!-- drawing-layout: width="100%" -->\n\n![Screenshot](${PNG_DATA})`;
        host.innerHTML = render(plainPng);
        const plainImg = host.querySelector('img')!;
        expect(plainImg.style.width).toBe('');
    });

    it('expands a mixed embedded PNG screenshot and sized inline drawing onto the drawing only', () => {
        const screenshot = 'data:image/png;base64,AAAA';
        const renderedDrawing = 'data:image/png;base64,BBBB';
        const markdown = `<!-- drawing-layout: width="480" -->\n\n![Screenshot](${screenshot}) ![Embedded drawing](${encodeInlineDrawing(SAMPLE_SCENE)} "Diagram title")`;
        const converted = new Map([[encodeInlineDrawing(SAMPLE_SCENE), renderedDrawing]]);
        const edits = drawingPreviewExpansionEdits(markdown, converted);
        let expanded = markdown;
        for (const edit of [...edits].sort((a, b) => b.start - a.start))
            expanded = expanded.slice(0, edit.start) + edit.text + expanded.slice(edit.end);

        expect(expanded).not.toContain('drawing-layout');
        const host = document.createElement('div');
        host.innerHTML = renderToStaticHTML(expanded);
        const imgs = host.querySelectorAll('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].getAttribute('src')).toBe(screenshot);
        expect(imgs[0].style.width).toBe('');
        expect(imgs[1].getAttribute('src')).toBe(renderedDrawing);
        expect(imgs[1].getAttribute('alt')).toBe('Embedded drawing');
        expect(imgs[1].getAttribute('title')).toBe('Diagram title');
        expect(imgs[1].style.width).toBe('480px');
        expect(imgs[1].style.maxWidth).toBe('100%');
        expect(imgs[1].style.height).toBe('auto');
    });

    it('expands sized drawings in blockquotes and keeps a reduced comment if another drawing fails to convert', () => {
        const renderedDrawing = 'data:image/png;base64,CCCC';
        const markdown = `> <!-- drawing-layout: widths="1:320,2:100%" -->\n>\n> ${INLINE_DRAWING} ${LINKED_DRAWING}`;
        const converted = new Map([[encodeInlineDrawing(SAMPLE_SCENE), renderedDrawing]]);
        const edits = drawingPreviewExpansionEdits(markdown, converted);
        let expanded = markdown;
        for (const edit of [...edits].sort((a, b) => b.start - a.start))
            expanded = expanded.slice(0, edit.start) + edit.text + expanded.slice(edit.end);

        expect(expanded).toContain('> <!-- drawing-layout: width="100%" -->');
        const host = document.createElement('div');
        host.innerHTML = renderToStaticHTML(expanded);
        const imgs = host.querySelectorAll<HTMLImageElement>('blockquote img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].style.width).toBe('320px');
        expect(imgs[1].style.width).toBe('100%');
    });

    it('preserves explicit 1-based drawing indices verbatim without compressing gaps during parse', () => {
        const parser = new MarkdownToState();
        const state = parser.generate(`<!-- drawing-layout: widths="2:100%" -->\n\n${INLINE_DRAWING} ${INLINE_DRAWING}`);
        expect(state).toHaveLength(1);
        expect(state[0]).toMatchObject({
            name: 'paragraph',
            meta: { drawingWidths: { 2: '100%' } },
        });
    });

    it('re-indexes remaining failed drawing when an earlier unsized drawing converts to PNG', () => {
        const renderedDrawing = 'data:image/png;base64,DDDD';
        const markdown = `<!-- drawing-layout: widths="2:100%" -->\n\n${INLINE_DRAWING} ${LINKED_DRAWING}`;
        const converted = new Map([[encodeInlineDrawing(SAMPLE_SCENE), renderedDrawing]]);
        const edits = drawingPreviewExpansionEdits(markdown, converted);
        let expanded = markdown;
        for (const edit of [...edits].sort((a, b) => b.start - a.start))
            expanded = expanded.slice(0, edit.start) + edit.text + expanded.slice(edit.end);

        expect(expanded).toContain('<!-- drawing-layout: width="100%" -->');
        expect(expanded).not.toContain('widths="2:100%"');
        const host = document.createElement('div');
        host.innerHTML = renderToStaticHTML(expanded);
        const imgs = host.querySelectorAll('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].getAttribute('src')).toBe(renderedDrawing);
        expect(imgs[0].style.width).toBe('');
        expect(imgs[1].style.width).toBe('100%');
        expect(imgs[1].style.height).toBe('auto');
    });

    it('exports fenced excalidraw widths via MarkdownToHtml', async () => {
        const fakeMuya = {
            options: {
                embeddedDrawing: {
                    label: () => 'Embedded drawing',
                    preview: async () => PNG_DATA,
                    open: () => {},
                },
            },
        } as unknown as Muya;

        const fullHtml = await new MarkdownToHtml(`<!-- drawing-layout: width="100%" -->\n\n${FENCED_DRAWING}`, fakeMuya).renderHtml();
        const host = document.createElement('div');
        host.innerHTML = fullHtml;
        const fullImg = host.querySelector('figure img') as HTMLImageElement;
        expect(fullImg).not.toBeNull();
        expect(fullImg.style.width).toBe('100%');
        expect(fullImg.style.height).toBe('auto');

        const pxHtml = await new MarkdownToHtml(`<!-- drawing-layout: width="360" -->\n\n${FENCED_DRAWING}`, fakeMuya).renderHtml();
        host.innerHTML = pxHtml;
        const pxImg = host.querySelector('figure img') as HTMLImageElement;
        expect(pxImg.style.width).toBe('360px');
        expect(pxImg.style.maxWidth).toBe('100%');
        expect(pxImg.style.height).toBe('auto');
    });
});
