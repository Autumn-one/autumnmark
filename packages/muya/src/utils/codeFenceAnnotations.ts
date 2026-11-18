import { firstWordOfInfo } from './index';

export interface ICodeLineRange {
    start: number;
    end: number;
}

export interface ICodeFenceAnnotations {
    title?: string;
    ranges: ICodeLineRange[];
}

const INFO_PARTS = /\{[^{}\r\n]*\}|(?:[^\s"']|"(?:[^"\\\r\n]|\\[^\r\n])*"|'(?:[^'\\\r\n]|\\[^\r\n])*')+/g;
const TITLE = /^title=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')$/;
const RANGE = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/;

export function codeFenceLanguage(info: string): string {
    return /^(?:title=["']|\{\s*\d)/.test(info.trimStart()) ? '' : firstWordOfInfo(info);
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
    const ranges: ICodeLineRange[] = [];
    for (const [part] of info.matchAll(INFO_PARTS)) {
        const match = TITLE.exec(part);
        if (match) {
            title = (match[1] ?? match[2]).replace(/\\(["'\\])/g, '$1') || undefined;
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
    return { title, ranges: merged };
}
