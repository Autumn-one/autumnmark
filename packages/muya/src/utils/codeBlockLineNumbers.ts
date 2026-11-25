import type { ICodeLineRange } from './codeFenceAnnotations';
import { CLASS_NAMES } from '../config';

// A trailing newline counts as an empty visible row. Count without allocating
// a match array because large code blocks update on every keystroke.
const LF = 10;

export function computeLineCount(text: string): number {
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === LF)
            count++;
    }
    return count;
}

export const LINE_NUMBERS_ROWS_CLASS = 'mu-line-numbers-rows';

export function lineNumbersWrapperHTML(): string {
    return `<span class="${LINE_NUMBERS_ROWS_CLASS}" contenteditable="false" aria-hidden="true"></span>`;
}

// Update only the span-count delta; unchanged line counts preserve existing nodes.
export function syncLineNumbersSpans(wrapper: HTMLElement, count: number): void {
    let current = wrapper.childElementCount;
    while (current < count) {
        wrapper.appendChild(wrapper.ownerDocument.createElement('span'));
        current++;
    }
    while (current > count) {
        wrapper.lastElementChild!.remove();
        current--;
    }
}

// Viewport tops of the logical lines in `codeEl`, in order. Lines at the end
// with nothing to measure are left out.
export function measureLineTops(codeEl: HTMLElement): number[] {
    const text = codeEl.textContent ?? '';

    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === LF)
            lineStarts.push(i + 1);
    }

    const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const tops: number[] = [];

    let nodeStart = 0;
    let node = walker.nextNode() as Text | null;

    while (node !== null && tops.length < lineStarts.length) {
        const nodeEnd = nodeStart + node.data.length;

        // A line beginning at nodeEnd belongs to the next text node.
        while (tops.length < lineStarts.length && lineStarts[tops.length] < nodeEnd) {
            const offsetInNode = lineStarts[tops.length] - nodeStart;
            range.setStart(node, offsetInNode);
            // A caret position on an empty line has no client rect (#5294), so
            // an empty line is measured by its own newline.
            if (node.data.charCodeAt(offsetInNode) === LF)
                range.setEnd(node, offsetInNode + 1);
            else
                range.collapse(true);
            tops.push(range.getBoundingClientRect().top);
        }

        nodeStart = nodeEnd;
        node = walker.nextNode() as Text | null;
    }

    // The line after a final "\n" has no text of its own; CodeBlockContent
    // renders a trailing break there to give it a line box.
    const trailingBreak = codeEl.querySelector(`.${CLASS_NAMES.MU_TRAILING_BREAK}`);
    if (trailingBreak !== null && tops.length === lineStarts.length - 1)
        tops.push(trailingBreak.getBoundingClientRect().top);

    return tops;
}

// Align numbers to visual line tops in wrap mode. Call after layout, via requestAnimationFrame.
export function repositionLineNumberSpans(
    wrapper: HTMLElement,
    codeEl: HTMLElement,
    tops = measureLineTops(codeEl),
): void {
    const spans = Array.from(wrapper.children) as HTMLElement[];
    if (spans.length === 0)
        return;

    const measuredCount = Math.min(tops.length, spans.length);
    // Anchor to the first text line, not the wrapper top, to cancel line-box leading.
    for (let i = 0; i < measuredCount; i++)
        spans[i].style.top = `${tops[i] - tops[0]}px`;

    // Unmeasurable empty lines stack by line-height; the first stays at the gutter top.
    if (measuredCount < spans.length) {
        const lineH = Number.parseFloat(getComputedStyle(wrapper).lineHeight) || 24;
        for (let i = measuredCount; i < spans.length; i++) {
            const prevTop = i > 0 ? Number.parseFloat(spans[i - 1].style.top || '0') : 0;
            spans[i].style.top = i > 0 ? `${prevTop + lineH}px` : '0px';
        }
    }
}

/** Paint full logical lines, including all visual rows of a wrapped source line. */
export function lineHighlightBackground(tops: number[], height: number, ranges: ICodeLineRange[]): string {
    const origin = tops[0];
    if (origin === undefined || height <= 0)
        return '';

    const stops = ['transparent 0'];
    const ink = 'var(--mu-code-line-highlight)';
    for (const { start, end } of ranges) {
        if (start > tops.length)
            break;
        const from = tops[start - 1] - origin;
        const to = end < tops.length ? tops[end] - origin : height;
        stops.push(`transparent ${from}px`, `${ink} ${from}px`, `${ink} ${to}px`, `transparent ${to}px`);
    }
    return stops.length > 1 ? `linear-gradient(to bottom, ${stops.join(', ')})` : '';
}
