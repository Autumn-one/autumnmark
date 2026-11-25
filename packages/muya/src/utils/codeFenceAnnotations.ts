import { firstWordOfInfo } from './index';

export interface ICodeLineRange {
    start: number;
    end: number;
}

export interface ICodeFenceAnnotations {
    title?: string;
    ranges: ICodeLineRange[];
    maxLines?: number | 'none';
}

const INFO_PARTS = /\{[^{}\r\n]*\}|(?:[^\s"']|"(?:[^"\\\r\n]|\\[^\r\n])*"|'(?:[^'\\\r\n]|\\[^\r\n])*')+/g;
const TITLE = /^title=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')$/;
const RANGE = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/;

export function codeFenceLanguage(info: string): string {
    return /^(?:title=["']|max-lines=|\{\s*\d)/.test(info.trimStart()) ? '' : firstWordOfInfo(info);
}

export function replaceCodeFenceMaxLines(info: string, lines: ICodeFenceAnnotations['maxLines']): string {
    const parts = [...info.matchAll(INFO_PARTS)].filter(([part]) => part.startsWith('max-lines='));
    const replacement = lines === undefined ? '' : `max-lines=${lines}`;
    const first = parts[0];
    if (!first)
        return replacement ? [info, replacement].filter(Boolean).join(' ') : info;

    // Edit spans from the end to preserve unrelated attributes, quoting and spacing.
    let result = info;
    for (const match of parts.reverse()) {
        const start = match.index;
        const end = start + match[0].length;
        if (match === first && replacement)
            result = result.slice(0, start) + replacement + result.slice(end);
        else if (start === 0)
            result = result.slice(end).trimStart();
        else
            result = result.slice(0, start).trimEnd() + result.slice(end);
    }
    return result;
}

export function replaceCodeFenceLanguage(info: string, language: string): string {
    const source = info.trim();
    const suffix = source.slice(codeFenceLanguage(source).length).trimStart();
    return [language, suffix].filter(Boolean).join(' ');
}

function parseLineRanges(source: string): ICodeLineRange[] {
    const ranges: ICodeLineRange[] = [];
    for (const part of source.split(',')) {
        const match = RANGE.exec(part);
        if (!match)
            return [];
        const start = Number(match[1]);
        const end = Number(match[2] ?? match[1]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)
            return [];
        ranges.push({ start, end });
    }
    return ranges;
}

/** Inclusive source-line ranges, coalesced so long or overlapping ranges stay compact. */
export function parseCodeFenceAnnotations(info: string): ICodeFenceAnnotations {
    let title: string | undefined;
    let maxLines: ICodeFenceAnnotations['maxLines'];
    const ranges: ICodeLineRange[] = [];
    for (const [part] of info.matchAll(INFO_PARTS)) {
        const match = TITLE.exec(part);
        if (match) {
            title = (match[1] ?? match[2]).replace(/\\(["'\\])/g, '$1') || undefined;
        }
        else if (part.startsWith('max-lines=')) {
            const value = part.slice('max-lines='.length);
            if (value === 'none') {
                maxLines = 'none';
            }
            else {
                const count = Number(value);
                maxLines = /^\d+$/.test(value) && Number.isSafeInteger(count) && count > 0 ? count : undefined;
            }
        }
        else if (part.startsWith('{') && part.endsWith('}')) {
            for (const range of parseLineRanges(part.slice(1, -1)))
                ranges.push(range);
        }
    }

    const merged: ICodeLineRange[] = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end + 1)
            previous.end = Math.max(previous.end, range.end);
        else
            merged.push(range);
    }
    return { title, ranges: merged, maxLines };
}
