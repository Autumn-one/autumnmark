// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import StateToMarkdown from '../../state/stateToMarkdown';
import { CopyType } from '../types';

const mountedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    for (const host of mountedHosts.splice(0))
        host.remove();
});

function mountMuya(markdown: string, copyParagraphNewlines: 'double' | 'single' = 'double') {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        copyParagraphNewlines,
        preferLooseListItem: true,
    });
    muya.init();
    mountedHosts.push(muya.domNode);
    return muya;
}

function selectAllBlocks(muya: Muya) {
    const scrollPage = muya.editor.scrollPage!;
    const first = scrollPage.firstContentInDescendant()!;
    const last = scrollPage.lastContentInDescendant()!;
    const anchor = { block: first, offset: 0 };
    const focus = { block: last, offset: last.text.length };
    muya.editor.selection.setSelection({ anchor, focus });
    // Mirror resolved selection directly so clipboard reads the full range under happy-dom.
    vi.spyOn(muya.editor.selection, 'getTextSelection').mockReturnValue({
        anchor,
        focus,
        anchorBlock: first,
        anchorPath: first.path,
        anchorOffset: 0,
        focusBlock: last,
        focusPath: last.path,
        focusOffset: last.text.length,
        isCollapsed: false,
        isSameBlockSync: first === last,
        isSelectionInSameBlock: first === last,
        direction: 'forward' as never,
        type: 'Range',
    });
}

function runCopy(muya: Muya, copyType: CopyType) {
    const setData = vi.fn();
    const clipboard = muya.editor.clipboard;
    clipboard.copyType = copyType;
    try {
        clipboard.copyHandler({
            clipboardData: { setData },
        } as unknown as ClipboardEvent);
    }
    finally {
        clipboard.copyType = CopyType.NORMAL;
    }
    const plainCall = setData.mock.calls.find(([format]) => format === 'text/plain');
    const htmlCall = setData.mock.calls.find(([format]) => format === 'text/html');
    return {
        text: plainCall?.[1] as string | undefined,
        html: htmlCall?.[1] as string | undefined,
    };
}

describe('stateToMarkdown compactBlockNewlines', () => {
    it('collapses inter-block blank lines while preserving empty lines inside code blocks', () => {
        const source = [
            '# Title',
            '',
            'First paragraph.',
            '',
            'Second paragraph.',
            '',
            '```js',
            'const a = 1;',
            '',
            'const b = 2;',
            '```',
            '',
            '> Quote one',
            '>',
            '> Quote two',
            '',
            '- item 1',
            '',
            '- item 2',
            '',
        ].join('\n');

        const muya = mountMuya(source);
        const states = muya.getState();
        const standard = new StateToMarkdown().generate(states);
        const compact = new StateToMarkdown({ compactBlockNewlines: true }).generate(states);

        expect(standard).toContain('First paragraph.\n\nSecond paragraph.');
        expect(standard).toContain('const a = 1;\n\nconst b = 2;');

        expect(compact).toBe([
            '# Title',
            'First paragraph.',
            'Second paragraph.',
            '```js',
            'const a = 1;',
            '',
            'const b = 2;',
            '```',
            '> Quote one',
            '> Quote two',
            '- item 1',
            '- item 2',
            '',
        ].join('\n'));
    });
});

describe('clipboard copyParagraphNewlines and alternate copy', () => {
    const sample = 'First paragraph.\n\nSecond paragraph.\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n';

    it('defaults to double newlines for normal copy and single newlines for alternate copy', () => {
        const muya = mountMuya(sample, 'double');
        selectAllBlocks(muya);

        const normal = runCopy(muya, CopyType.NORMAL);
        expect(normal.text).toBe(sample);
        expect(normal.html).toBe('');

        const alternate = runCopy(muya, CopyType.COPY_ALTERNATE_NEWLINES);
        expect(alternate.text).toBe('First paragraph.\nSecond paragraph.\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n');
        expect(alternate.html).toBe('');
    });

    it('uses single newlines for normal copy and double newlines for alternate copy when set to single', () => {
        const muya = mountMuya(sample, 'single');
        selectAllBlocks(muya);

        const normal = runCopy(muya, CopyType.NORMAL);
        expect(normal.text).toBe('First paragraph.\nSecond paragraph.\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n');

        const alternate = runCopy(muya, CopyType.COPY_ALTERNATE_NEWLINES);
        expect(alternate.text).toBe(sample);
    });

    it('keeps copyAsRich, copyAsHtml, and saved markdown standard even when copyParagraphNewlines is single', () => {
        const muya = mountMuya('First.\n\nSecond.\n', 'single');
        selectAllBlocks(muya);

        expect(muya.getMarkdown()).toBe('First.\n\nSecond.\n');

        const rich = runCopy(muya, CopyType.COPY_AS_RICH);
        expect(rich.text).toBe('First.\n\nSecond.\n');
        expect(rich.html).toContain('<p>First.</p>');
        expect(rich.html).toContain('<p>Second.</p>');

        const html = runCopy(muya, CopyType.COPY_AS_HTML);
        expect(html.text).toContain('First.');
        expect(html.text).toContain('<p>Second.</p>');
    });

    it('respects runtime setOptions updates without rebuilding the document', () => {
        const muya = mountMuya('Alpha.\n\nBeta.\n', 'double');
        selectAllBlocks(muya);

        expect(runCopy(muya, CopyType.NORMAL).text).toBe('Alpha.\n\nBeta.\n');

        muya.setOptions({ copyParagraphNewlines: 'single' }, false);
        expect(runCopy(muya, CopyType.NORMAL).text).toBe('Alpha.\nBeta.\n');
        expect(runCopy(muya, CopyType.COPY_ALTERNATE_NEWLINES).text).toBe('Alpha.\n\nBeta.\n');
    });
});
