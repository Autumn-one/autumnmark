// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { headingLinkAt } from '../inline/headingLink';
import { getMarkdownOutline, getStateSections } from '../state/markdownOutline';
import { MarkdownToState } from '../state/markdownToState';

describe('section and anchor boundaries', () => {
    it('keeps an open source fence anchored to the end of the file', () => {
        const source = '# A\n\n# B\n\n~~~~sh\ntext\n~~~';
        expect(getMarkdownOutline(source).endScope).toBe(source.length);
        expect(getMarkdownOutline(`${source}~\n`).endScope).toBe(-1);
    });
    it('finds source offsets without counting headings in metadata, code, HTML or quotes', () => {
        const md = '---\n# metadata\n---\n\n> # Quoted\n\n````md\n```\n# Fake\n````\n\n<div>\n# Hidden\n</div>\n\nReal\nTitle\n----\n\n# **安装**\n\n## 安装\n\n# 安装-1';
        const { headings } = getMarkdownOutline(md);
        expect(headings.map(h => h.anchor)).toEqual(['real-title', '安装', '安装-1', '安装-1-1']);
        expect(headings.map(h => h.offset)).toEqual(['Real\n', '# **安装', '## 安装', '# 安装-1'].map(line => md.indexOf(line)));
    });

    it('keeps paired fold and tab markers with their contents', () => {
        const md = '# Outer\n\n<!-- fold -->\n\n## Details\n\n<!-- tabs -->\n\n### | CLI\n\nA\n\n### | UI\n\nB\n\n<!-- /tabs -->\n\n<!-- /fold -->\n\n## Next';
        const source = getMarkdownOutline(md).headings;
        const state = getStateSections(new MarkdownToState().generate(md)).headings;
        expect(source.map(h => h.content)).toEqual(['Outer', 'Details', 'CLI', 'UI', 'Next']);
        expect(source.map(h => h.scope)).toEqual([-1, -1, md.indexOf('<!-- fold'), md.indexOf('<!-- tabs'), -1]);
        expect(state.map(h => h.scope < 0)).toEqual(source.map(h => h.scope < 0));
        expect(source[1].sectionStart).toBe(md.indexOf('<!-- fold'));
    });
});

describe('inline heading links', () => {
    it('preserves a formatted label, optional title, and surrounding paragraph text', () => {
        const text = 'See [**help**](guide.md#in "guide") or [home](index.md).';
        const pos = text.indexOf(' "guide"');
        const edit = headingLinkAt(text, pos)?.complete('guide.md#install', 'Install');
        expect(edit && text.slice(0, edit.from) + edit.text + text.slice(edit.to)).toBe(text.replace('#in', '#install'));
    });

    it('completes an unfinished link with an empty label', () => {
        const text = 'See [](#two words';
        expect(headingLinkAt(text, text.length)?.complete('#two-words', 'Two [words]').text)
            .toBe('[Two \\[words\\]](#two-words)');
    });

    it.each(['# Title', '![figure](#x)', '`[label](#x)`', '[page](https://example.com/#x)', '\\[literal](#x)'])(
        'ignores non-heading destinations in %s',
        (text) => {
            const offset = text.includes('#x') ? text.indexOf('#x') + 2 : text.length;
            expect(headingLinkAt(text, offset)).toBeUndefined();
        },
    );
});
