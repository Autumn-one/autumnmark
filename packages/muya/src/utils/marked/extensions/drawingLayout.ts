import type { MarkedExtension, Tokens } from 'marked';
import type { TDrawingWidth } from '../../../state/types';
import { Renderer } from 'marked';
import { codeFenceLanguage } from '../../codeFenceAnnotations';
import { isDrawingImageSource } from '../../diagram/drawingData';
import { diagramTypeOfLang } from '../../diagram/fence';
import { countParagraphDrawings, drawingInlineStyle, parseDrawingLayoutFields } from '../../drawingLayout';

export interface ISizedDiagramCodeToken extends Tokens.Code {
    drawingWidth?: TDrawingWidth;
}

export interface ISizedDrawingParagraphToken extends Tokens.Paragraph {
    drawingWidths?: Record<string, TDrawingWidth>;
}

const MARKER = /^ {0,3}<!-- drawing-layout: ([^\r\n]*?) -->[ \t]*\r?\n(?:[ \t]*\r?\n)*/;
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const SRC_ATTR = /\bsrc=(?:"([^"]*)"|'([^']*)')/i;
const STYLE_ATTR = /\bstyle=(?:"([^"]*)"|'([^']*)')/i;

function injectStyleIntoImgTag(tag: string, style: string): string {
    const existing = STYLE_ATTR.exec(tag);
    if (existing) {
        const value = (existing[1] ?? existing[2] ?? '').trim().replace(/;$/, '');
        const merged = value ? `${value};${style}` : style;
        return `${tag.slice(0, existing.index)}style="${merged}"${tag.slice(existing.index + existing[0].length)}`;
    }
    return tag.replace(/^<img\b/i, `<img style="${style}"`);
}

function applyWidthsToParagraphHtml(html: string, widths: Record<string, TDrawingWidth>): string {
    const matches = [...html.matchAll(IMG_TAG)];
    if (!matches.length)
        return html;

    const extractSrc = (tag: string) => {
        const match = SRC_ATTR.exec(tag);
        return match?.[1] ?? match?.[2] ?? '';
    };

    const targets = matches.filter(match => isDrawingImageSource(extractSrc(match[0])));
    if (!targets.length)
        return html;

    const replacements = new Map<number, { length: number; value: string }>();
    targets.forEach((match, index) => {
        const width = widths[String(index + 1)];
        if (width === undefined)
            return;
        replacements.set(match.index, {
            length: match[0].length,
            value: injectStyleIntoImgTag(match[0], drawingInlineStyle(width)),
        });
    });
    if (!replacements.size)
        return html;

    let result = '';
    let pos = 0;
    for (const [start, replacement] of [...replacements.entries()].sort((a, b) => a[0] - b[0])) {
        result += html.slice(pos, start) + replacement.value;
        pos = start + replacement.length;
    }
    return result + html.slice(pos);
}

export default function drawingLayoutExtension(): MarkedExtension {
    return {
        extensions: [{
            name: 'sizedDrawing',
            level: 'block',
            tokenizer(src) {
                const marker = MARKER.exec(src);
                if (!marker)
                    return;
                const layout = parseDrawingLayoutFields(marker[1]);
                if (!layout)
                    return;

                const rest = src.slice(marker[0].length);
                const tokenizer = this.lexer.options.tokenizer;
                if (!tokenizer)
                    return;

                const fenced = tokenizer.fences(rest) as ISizedDiagramCodeToken | undefined;
                if (fenced) {
                    const lang = codeFenceLanguage((fenced.lang ?? '').trim());
                    if (diagramTypeOfLang(lang) !== 'excalidraw' || layout.mode !== 'single')
                        return;
                    fenced.raw = marker[0] + fenced.raw;
                    fenced.drawingWidth = layout.widths.get(1);
                    return fenced;
                }

                // Higher-precedence blocks must not be misread as paragraphs under a drawing comment.
                if (
                    tokenizer.code(rest)
                    || tokenizer.heading(rest)
                    || tokenizer.lheading(rest)
                    || tokenizer.hr(rest)
                    || tokenizer.blockquote(rest)
                    || tokenizer.list(rest)
                    || tokenizer.html(rest)
                    || tokenizer.def(rest)
                    || tokenizer.table(rest)
                ) {
                    return;
                }

                const paragraph = tokenizer.paragraph(rest) as ISizedDrawingParagraphToken | undefined;
                if (!paragraph || countParagraphDrawings(paragraph.text) < 1)
                    return;

                paragraph.raw = marker[0] + paragraph.raw;
                paragraph.drawingWidths = Object.fromEntries(
                    [...layout.widths.entries()].map(([index, width]) => [String(index), width]),
                );
                return paragraph;
            },
        }],
        renderer: {
            code(token) {
                const sized = token as ISizedDiagramCodeToken;
                if (sized.drawingWidth === undefined)
                    return false;
                const html = Renderer.prototype.code.call(this, token);
                const style = sized.drawingWidth === '100%'
                    ? 'width:100%'
                    : `width:${sized.drawingWidth}px;max-width:100%`;
                return html.replace('<pre>', `<pre style="${style}">`);
            },
            paragraph(token) {
                const sized = token as ISizedDrawingParagraphToken;
                if (!sized.drawingWidths)
                    return false;
                const html = Renderer.prototype.paragraph.call(this, token);
                return applyWidthsToParagraphHtml(html, sized.drawingWidths);
            },
        },
    };
}
