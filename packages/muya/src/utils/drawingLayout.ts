import type { Token } from '../inline/model/types';
import type { IDiagramState, IParagraphState, TDrawingWidth } from '../state/types';
import diff from 'fast-diff';
import { parse, postprocess, preprocess } from 'micromark';
import { compactImagePayloads, embeddedImageDestination, findDocumentImages } from '../clipboard/pastedImageSources';
import { parseInline } from '../inline/parser/lexer';
import { isDrawingImageSource, isDrawingImageToken } from './diagram/drawingData';
import { imageToHtml } from './image';

const FIELD = /^(width|widths)="([^"]+)"$/;
const WIDTH_VALUE = /^(?:[1-9]\d*|100%)$/;
const INDEXED_ENTRY = /^([1-9]\d*):([1-9]\d*|100%)$/;
const STANDALONE_COMMENT = /^ {0,3}<!-- drawing-layout: ([^\r\n]*?) -->[ \t]*$/;

export interface IParsedDrawingLayout {
    mode: 'single' | 'indexed';
    widths: Map<number, TDrawingWidth>;
}

export interface IMarkdownEdit {
    start: number;
    end: number;
    text: string;
}

export interface IDrawingSpan {
    src: string;
    start: number;
    end: number;
}

function parseWidthValue(raw: string): TDrawingWidth | undefined {
    if (!WIDTH_VALUE.test(raw))
        return;
    if (raw === '100%')
        return '100%';
    const pixels = Number(raw);
    return Number.isSafeInteger(pixels) && pixels > 0 ? pixels : undefined;
}

export function parseDrawingLayoutFields(fields: string): IParsedDrawingLayout | undefined {
    const trimmed = fields.trim();
    if (!trimmed)
        return;
    const parts = trimmed.split(/[ \t]+/);
    if (parts.length !== 1)
        return;
    const match = FIELD.exec(parts[0]);
    if (!match)
        return;

    const widths = new Map<number, TDrawingWidth>();
    if (match[1] === 'width') {
        const value = parseWidthValue(match[2]);
        if (value === undefined)
            return;
        widths.set(1, value);
        return { mode: 'single', widths };
    }

    for (const pair of match[2].split(',')) {
        const entry = INDEXED_ENTRY.exec(pair);
        if (!entry)
            return;
        const index = Number(entry[1]);
        const value = parseWidthValue(entry[2]);
        if (!Number.isSafeInteger(index) || index < 1 || value === undefined || widths.has(index))
            return;
        widths.set(index, value);
    }
    return widths.size ? { mode: 'indexed', widths } : undefined;
}

function collectDrawingSpans(tokens: Token[], spans: IDrawingSpan[]): void {
    for (const token of tokens) {
        if (isDrawingImageToken(token)) {
            spans.push({
                src: token.attrs.src,
                start: token.range.start,
                end: token.range.end,
            });
            continue;
        }
        if ('children' in token && Array.isArray(token.children))
            collectDrawingSpans(token.children, spans);
    }
}

export function paragraphDrawingSpans(text: string): IDrawingSpan[] {
    if (!text || !/excalidraw/i.test(text))
        return [];
    const spans: IDrawingSpan[] = [];
    collectDrawingSpans(parseInline(text), spans);
    return spans;
}

export function paragraphDrawingSources(text: string): string[] {
    return paragraphDrawingSpans(text).map(span => span.src);
}

export function countParagraphDrawings(text: string): number {
    return paragraphDrawingSpans(text).length;
}

export function normalizeDrawingWidths(
    widths: Record<string, TDrawingWidth> | Map<number, TDrawingWidth> | undefined,
): Record<string, TDrawingWidth> | undefined {
    if (!widths)
        return;
    const entries = widths instanceof Map
        ? [...widths.entries()]
        : Object.entries(widths).map(([key, value]) => [Number(key), value] as const);
    const valid = entries
        .filter(([index, value]) =>
            Number.isSafeInteger(index) && index >= 1
            && (value === '100%' || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)),
        )
        .sort((a, b) => a[0] - b[0]);
    if (!valid.length)
        return;
    return Object.fromEntries(valid.map(([index, value]) => [String(index), value]));
}

interface IEqualChunk {
    oldStart: number;
    newStart: number;
    length: number;
}

function equalDiffChunks(oldText: string, newText: string): IEqualChunk[] {
    const chunks: IEqualChunk[] = [];
    let oldPos = 0;
    let newPos = 0;
    for (const [op, segment] of diff(oldText, newText)) {
        const length = segment.length;
        if (op === diff.EQUAL) {
            if (length > 0)
                chunks.push({ oldStart: oldPos, newStart: newPos, length });
            oldPos += length;
            newPos += length;
        }
        else if (op === diff.DELETE) {
            oldPos += length;
        }
        else if (op === diff.INSERT) {
            newPos += length;
        }
    }
    return chunks;
}

function findUnchangedOldSpanIndex(
    newSpan: IDrawingSpan,
    oldSpans: IDrawingSpan[],
    claimedOld: Set<number>,
    chunks: IEqualChunk[],
): number {
    let bestOld = -1;
    let bestOverlap = 0;
    for (const chunk of chunks) {
        const overlapStart = Math.max(newSpan.start, chunk.newStart);
        const overlapEnd = Math.min(newSpan.end, chunk.newStart + chunk.length);
        if (overlapEnd <= overlapStart)
            continue;
        const mappedStart = chunk.oldStart + (overlapStart - chunk.newStart);
        const mappedEnd = chunk.oldStart + (overlapEnd - chunk.newStart);
        for (let oi = 0; oi < oldSpans.length; oi++) {
            if (claimedOld.has(oi) || oldSpans[oi].src !== newSpan.src)
                continue;
            const spanOverlap = Math.min(mappedEnd, oldSpans[oi].end) - Math.max(mappedStart, oldSpans[oi].start);
            if (spanOverlap > bestOverlap) {
                bestOverlap = spanOverlap;
                bestOld = oi;
            }
        }
    }
    return bestOld;
}

export function remapDrawingWidthsBySource(
    widths: Record<string, TDrawingWidth> | undefined,
    oldText: string,
    newText: string,
): Record<string, TDrawingWidth> | undefined {
    const normalized = normalizeDrawingWidths(widths);
    if (!normalized)
        return;
    const newSpans = paragraphDrawingSpans(newText);
    if (!newSpans.length)
        return;
    const oldSpans = paragraphDrawingSpans(oldText);
    if (!oldSpans.length)
        return;

    const chunks = equalDiffChunks(oldText, newText);
    const claimedOld = new Set<number>();
    const matchedOld = Array.from<number>({ length: newSpans.length }).fill(-1);

    // Pass 1: anchor surviving tokens onto unchanged text spans from the diff.
    newSpans.forEach((span, ni) => {
        const oi = findUnchangedOldSpanIndex(span, oldSpans, claimedOld, chunks);
        if (oi >= 0) {
            claimedOld.add(oi);
            matchedOld[ni] = oi;
        }
    });

    // Pass 2: match any remaining modified-wrapper tokens left-to-right by identical `src`.
    const remainingBySrc = new Map<string, number[]>();
    oldSpans.forEach((span, oi) => {
        if (claimedOld.has(oi))
            return;
        const list = remainingBySrc.get(span.src);
        if (list)
            list.push(oi);
        else
            remainingBySrc.set(span.src, [oi]);
    });

    newSpans.forEach((span, ni) => {
        if (matchedOld[ni] >= 0)
            return;
        const list = remainingBySrc.get(span.src);
        if (list?.length)
            matchedOld[ni] = list.shift()!;
    });

    const remapped: Record<string, TDrawingWidth> = {};
    matchedOld.forEach((oi, ni) => {
        if (oi < 0)
            return;
        const width = normalized[String(oi + 1)];
        if (width !== undefined)
            remapped[String(ni + 1)] = width;
    });
    return normalizeDrawingWidths(remapped);
}

/**
 * Partition drawing widths around an explicit character slice `[start, end]`:
 * - `extracted`: drawings contained inside `[start, end]`, re-indexed from 1.
 * - `remaining`: drawings outside `[start, end]`, re-indexed from 1 for `text.slice(0, start) + text.slice(end)`.
 */
export function extractRangeDrawingWidths(
    widths: Record<string, TDrawingWidth> | undefined,
    text: string,
    start: number,
    end: number,
): { remaining?: Record<string, TDrawingWidth>; extracted?: Record<string, TDrawingWidth> } {
    const normalized = normalizeDrawingWidths(widths);
    if (!normalized)
        return {};
    const spans = paragraphDrawingSpans(text);
    const remainingMap: Record<string, TDrawingWidth> = {};
    const extractedMap: Record<string, TDrawingWidth> = {};
    let remainingOrdinal = 0;
    let extractedOrdinal = 0;

    spans.forEach((span, index) => {
        const width = normalized[String(index + 1)];
        if (span.start >= start && span.end <= end) {
            extractedOrdinal++;
            if (width !== undefined)
                extractedMap[String(extractedOrdinal)] = width;
        }
        else if (span.end <= start || span.start >= end) {
            remainingOrdinal++;
            if (width !== undefined)
                remainingMap[String(remainingOrdinal)] = width;
        }
    });

    return {
        remaining: normalizeDrawingWidths(remainingMap),
        extracted: normalizeDrawingWidths(extractedMap),
    };
}

export function splitDrawingWidths(
    widths: Record<string, TDrawingWidth> | undefined,
    originalText: string,
    headText: string,
    tailText: string,
): { head?: Record<string, TDrawingWidth>; tail?: Record<string, TDrawingWidth> } {
    const normalized = normalizeDrawingWidths(widths);
    if (!normalized)
        return {};
    const totalCount = countParagraphDrawings(originalText);
    const headCount = countParagraphDrawings(headText);
    const tailCount = countParagraphDrawings(tailText);
    const tailStart = Math.max(headCount + 1, totalCount - tailCount + 1);

    const headMap: Record<string, TDrawingWidth> = {};
    const tailMap: Record<string, TDrawingWidth> = {};
    for (const [key, value] of Object.entries(normalized)) {
        const index = Number(key);
        if (index >= 1 && index <= headCount)
            headMap[String(index)] = value;
        else if (tailCount > 0 && index >= tailStart && index <= totalCount)
            tailMap[String(index - tailStart + 1)] = value;
    }
    return {
        head: normalizeDrawingWidths(headMap),
        tail: normalizeDrawingWidths(tailMap),
    };
}

export function mergeDrawingWidths(options: {
    existingWidths?: Record<string, TDrawingWidth>;
    oldText: string;
    head: string;
    inserted: string;
    tail: string;
    incomingWidths?: Record<string, TDrawingWidth>;
    detachedTail?: string;
}): { merged?: Record<string, TDrawingWidth>; detachedTail?: Record<string, TDrawingWidth> } {
    const { existingWidths, oldText, head, inserted, tail, incomingWidths, detachedTail = '' } = options;
    const split = splitDrawingWidths(existingWidths, oldText, head, detachedTail || tail);
    const headCount = countParagraphDrawings(head);
    const insertedCount = countParagraphDrawings(inserted);
    const incoming = normalizeDrawingWidths(incomingWidths);

    const combined: Record<string, TDrawingWidth> = {};
    if (split.head) {
        for (const [key, value] of Object.entries(split.head))
            combined[key] = value;
    }
    if (incoming) {
        for (const [key, value] of Object.entries(incoming)) {
            const index = Number(key);
            if (index >= 1 && index <= insertedCount)
                combined[String(headCount + index)] = value;
        }
    }
    if (!detachedTail && split.tail) {
        for (const [key, value] of Object.entries(split.tail)) {
            const index = Number(key);
            combined[String(headCount + insertedCount + index)] = value;
        }
    }

    return {
        merged: normalizeDrawingWidths(combined),
        detachedTail: detachedTail ? split.tail : undefined,
    };
}

export function formatDrawingLayoutComment(widths: Record<string, TDrawingWidth> | Map<number, TDrawingWidth> | undefined, maxCount?: number): string {
    const normalized = normalizeDrawingWidths(widths);
    if (!normalized)
        return '';
    const pairs = Object.entries(normalized)
        .map(([key, value]) => [Number(key), value] as const)
        .filter(([index]) => index >= 1 && (maxCount === undefined || index <= maxCount))
        .sort((a, b) => a[0] - b[0]);
    if (!pairs.length)
        return '';
    if (pairs.length === 1 && pairs[0][0] === 1)
        return `<!-- drawing-layout: width="${pairs[0][1]}" -->`;
    return `<!-- drawing-layout: widths="${pairs.map(([index, value]) => `${index}:${value}`).join(',')}" -->`;
}

export function drawingLayoutComment(state: IParagraphState | IDiagramState): string {
    if (state.name === 'diagram') {
        if (state.meta.type !== 'excalidraw' || state.meta.width === undefined)
            return '';
        return `<!-- drawing-layout: width="${state.meta.width}" -->`;
    }

    const count = countParagraphDrawings(state.text);
    if (count < 1)
        return '';
    return formatDrawingLayoutComment(state.meta?.drawingWidths, count);
}

export function drawingInlineStyle(width: TDrawingWidth): string {
    return width === '100%'
        ? 'width:100%;height:auto'
        : `width:${width}px;max-width:100%;height:auto`;
}

export function applyDrawingWidth(element: HTMLElement, width?: TDrawingWidth): void {
    element.classList.toggle('mu-drawing-full-width', width === '100%');
    if (typeof width === 'number' && Number.isSafeInteger(width) && width > 0) {
        element.classList.add('mu-drawing-sized');
        element.style.setProperty('--mu-drawing-width', `${width}px`);
    }
    else {
        element.classList.remove('mu-drawing-sized');
        element.style.removeProperty('--mu-drawing-width');
    }
}

interface IPendingDrawingComment {
    start: number;
    end: number;
    layout: IParsedDrawingLayout;
}

const CONTAINER_TOKENS = new Set(['blockQuote', 'listOrdered', 'listUnordered']);
const NON_PARAGRAPH_BLOCKS = new Set([
    'codeFenced',
    'codeIndented',
    'atxHeading',
    'setextHeading',
    'thematicBreak',
    'definition',
    'gfmTable',
]);

function findSizedDrawingParagraphs(markdown: string): { commentStart: number; commentEnd: number; paraStart: number; paraEnd: number; layout: IParsedDrawingLayout }[] {
    const { text, original } = compactImagePayloads(markdown);
    const events = postprocess(parse().document().write(preprocess()(text, undefined, true)));
    const stack: (IPendingDrawingComment | null)[] = [null];
    const results: { commentStart: number; commentEnd: number; paraStart: number; paraEnd: number; layout: IParsedDrawingLayout }[] = [];

    for (const [event, token] of events) {
        if (CONTAINER_TOKENS.has(token.type)) {
            if (event === 'enter') {
                stack[stack.length - 1] = null;
                stack.push(null);
            }
            else if (stack.length > 1) {
                stack.pop();
            }
            continue;
        }
        if (token.type === 'listItemPrefix' && event === 'enter') {
            stack[stack.length - 1] = null;
            continue;
        }
        if (token.type === 'htmlFlow' && event === 'exit') {
            const start = original(token.start.offset);
            const end = original(token.end.offset);
            const match = STANDALONE_COMMENT.exec(markdown.slice(start, end));
            const layout = match ? parseDrawingLayoutFields(match[1]) : undefined;
            stack[stack.length - 1] = layout ? { start, end, layout } : null;
            continue;
        }
        if (token.type === 'paragraph' && event === 'enter') {
            const pending = stack[stack.length - 1];
            stack[stack.length - 1] = null;
            if (pending) {
                results.push({
                    commentStart: pending.start,
                    commentEnd: pending.end,
                    paraStart: original(token.start.offset),
                    paraEnd: original(token.end.offset),
                    layout: pending.layout,
                });
            }
            continue;
        }
        if (event === 'enter' && NON_PARAGRAPH_BLOCKS.has(token.type))
            stack[stack.length - 1] = null;
    }
    return results;
}

/**
 * Build source edits to expand drawing previews for HTML/PDF export.
 * Sized paragraph drawings are rewritten into styled `<img>` tags while their
 * original drawing identity is still known, and their `<!-- drawing-layout -->`
 * comment is removed (or re-indexed for any remaining unconverted drawings) so
 * export never confuses drawings with ordinary embedded PNG images.
 */
export function drawingPreviewExpansionEdits(
    markdown: string,
    converted: ReadonlyMap<string, string>,
): IMarkdownEdit[] {
    const images = findDocumentImages(markdown);
    if (!converted.size || !images.length)
        return [];

    const edits: IMarkdownEdit[] = [];
    const handled = new Set<number>();

    if (markdown.includes('drawing-layout:')) {
        for (const match of findSizedDrawingParagraphs(markdown)) {
            const drawings = images
                .map((image, idx) => ({ image, idx }))
                .filter(({ image }) =>
                    image.markup !== undefined
                    && image.markup.start >= match.paraStart
                    && image.markup.end <= match.paraEnd
                    && image.unquotedAttribute === undefined
                    && image.referenceTitle === undefined
                    && isDrawingImageSource(image.src),
                );
            if (!drawings.length)
                continue;

            const remainingWidths = new Map<number, TDrawingWidth>();
            let convertedCount = 0;
            let unconvertedOrdinal = 0;
            drawings.forEach(({ image, idx }, ordinal) => {
                const width = match.layout.widths.get(ordinal + 1);
                const png = converted.get(image.src);
                if (!png || !image.markup) {
                    unconvertedOrdinal++;
                    if (width !== undefined)
                        remainingWidths.set(unconvertedOrdinal, width);
                    return;
                }
                convertedCount++;
                if (width === undefined)
                    return;
                const raw = markdown.slice(image.markup.start, image.markup.end);
                const [token] = parseInline(raw);
                const alt = token?.type === 'image' ? (token.attrs.alt ?? '') : '';
                const title = token?.type === 'image' ? (token.attrs.title ?? '') : '';
                const attrs: Record<string, string> = {
                    src: png,
                    alt,
                    ...(title ? { title } : {}),
                    style: drawingInlineStyle(width),
                };
                edits.push({
                    start: image.markup.start,
                    end: image.markup.end,
                    text: imageToHtml(attrs),
                });
                handled.add(idx);
            });

            if (convertedCount > 0) {
                if (remainingWidths.size === 0) {
                    edits.push({ start: match.commentStart, end: match.paraStart, text: '' });
                }
                else {
                    edits.push({
                        start: match.commentStart,
                        end: match.commentEnd,
                        text: formatDrawingLayoutComment(remainingWidths, unconvertedOrdinal),
                    });
                }
            }
        }
    }

    images.forEach((image, idx) => {
        if (handled.has(idx))
            return;
        const data = converted.get(image.src);
        if (data)
            edits.push({ start: image.start, end: image.end, text: embeddedImageDestination(image, data) });
    });

    return edits.sort((a, b) => a.start - b.start);
}
