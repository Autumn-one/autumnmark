// @vitest-environment happy-dom

import type { ISerializedHistory } from '../../history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { rewriteMermaidSvgIds } from '../../utils/diagram/mermaid';

const bootedEditors: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;
let originalDirname: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    originalDirname = window.DIRNAME;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedEditors.length) {
        const muya = bootedEditors.pop()!;
        const host = muya.domNode;
        muya.destroy();
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
    window.DIRNAME = originalDirname;
});

function bootMuya(markdown: string, extraOptions: Partial<ConstructorParameters<typeof Muya>[1]> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, ...extraOptions } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedEditors.push(muya);
    return muya;
}

describe('documentSessionPool and tab-switch engine optimizations', () => {
    it('hot-swaps retained documents while preserving B1 controller identities and DOM nodes', () => {
        const docA = '# Alpha\n\nParagraph A';
        const docB = '# Beta\n\nParagraph B';
        const muya = bootMuya(docA);

        const initialJsonState = muya.editor.jsonState;
        const initialHistory = muya.editor.history;
        const initialTransactions = muya.editor.transactions;
        const initialSelection = muya.editor.selection;
        const initialSearch = muya.editor.searchModule;
        const initialCompact = muya.editor.compactBlocks;
        const initialFold = muya.editor.foldBlocks;
        const initialContentTabs = muya.editor.contentTabs;

        muya.bindActiveDocument('tab-a', docA, { id: 'tab-a', pathname: '/a/docA.md', dirname: '/a' });
        const domA = muya.editor.scrollPage!.domNode;

        const firstVisitB = muya.activateDocument({
            id: 'tab-b',
            markdown: docB,
            context: { id: 'tab-b', pathname: '/b/docB.md', dirname: '/b' },
            readOnly: false,
        });
        expect(firstVisitB.hotHit).toBe(false);
        expect(muya.getMarkdown()).toContain('Paragraph B');
        const domB = muya.editor.scrollPage!.domNode;

        const returnToA = muya.activateDocument({
            id: 'tab-a',
            markdown: docA,
            context: { id: 'tab-a', pathname: '/a/docA.md', dirname: '/a' },
            readOnly: false,
        });
        expect(returnToA.hotHit).toBe(true);
        expect(muya.editor.scrollPage!.domNode).toBe(domA);
        expect(muya.getMarkdown()).toContain('Paragraph A');

        const returnToB = muya.activateDocument({
            id: 'tab-b',
            markdown: docB,
            context: { id: 'tab-b', pathname: '/b/docB.md', dirname: '/b' },
            readOnly: false,
        });
        expect(returnToB.hotHit).toBe(true);
        expect(muya.editor.scrollPage!.domNode).toBe(domB);

        expect(muya.editor.jsonState).toBe(initialJsonState);
        expect(muya.editor.history).toBe(initialHistory);
        expect(muya.editor.transactions).toBe(initialTransactions);
        expect(muya.editor.selection).toBe(initialSelection);
        expect(muya.editor.searchModule).toBe(initialSearch);
        expect(muya.editor.compactBlocks).toBe(initialCompact);
        expect(muya.editor.foldBlocks).toBe(initialFold);
        expect(muya.editor.contentTabs).toBe(initialContentTabs);
    });

    it('isolates per-tab undo stacks and serializes evicted history via onEvict', () => {
        const docA = 'Initial A';
        const muya = bootMuya(docA);
        muya.bindActiveDocument('tab-a', docA, { id: 'tab-a' });

        muya.replaceContent('Edited A');
        muya.markActiveDocumentModified(muya.getMarkdown());
        const editedA = muya.getMarkdown();

        // Switch across 9 more tabs so the default 8-session cap evicts tab-a.
        const evicted: Array<{ id: string; history: ISerializedHistory }> = [];
        const onEvict = (id: string, history: ISerializedHistory) => {
            evicted.push({ id, history });
        };

        for (let i = 1; i <= 10; i++) {
            muya.activateDocument({
                id: `tab-${i}`,
                markdown: `Doc ${i}`,
                context: { id: `tab-${i}` },
                readOnly: false,
                onEvict,
            });
        }

        const evictedA = evicted.find(entry => entry.id === 'tab-a');
        expect(evictedA).toBeDefined();
        expect(evictedA!.history.stack.undo.length).toBeGreaterThan(0);

        // Cold re-activation of tab-a can replay the evicted history and undo cleanly.
        const reopenA = muya.activateDocument({
            id: 'tab-a',
            markdown: editedA,
            context: { id: 'tab-a' },
            readOnly: false,
        });
        expect(reopenA.hotHit).toBe(false);
        muya.setHistory(evictedA!.history);
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('Initial A');
    });

    it('invalidates retained sessions lazily on structural option updates while keeping CSS-only updates hot', () => {
        const docA = 'Alpha';
        const docB = 'Beta';
        const muya = bootMuya(docA);
        muya.bindActiveDocument('tab-a', docA, { id: 'tab-a' });

        muya.activateDocument({ id: 'tab-b', markdown: docB, context: { id: 'tab-b' }, readOnly: false });
        muya.setOptions({ fontSize: 18 }, false);

        const hotReturnToA = muya.activateDocument({ id: 'tab-a', markdown: docA, context: { id: 'tab-a' }, readOnly: false });
        expect(hotReturnToA.hotHit).toBe(true);

        muya.setOptions({ codeBlockLineNumbers: true }, true);
        const coldReturnToB = muya.activateDocument({ id: 'tab-b', markdown: docB, context: { id: 'tab-b' }, readOnly: false });
        expect(coldReturnToB.hotHit).toBe(false);
    });

    it('prewarms an inactive tab using explicit IDocumentContext without touching window.DIRNAME', () => {
        window.DIRNAME = '/active-dir';
        const resolveSpy = vi.fn((_src: string, _pathname?: string) => undefined);
        const docA = 'Active doc';
        const docB = '![diagram](./diagram.excalidraw)';
        const muya = bootMuya(docA, { resolveImagePreview: resolveSpy });
        muya.bindActiveDocument('tab-a', docA, { id: 'tab-a', pathname: '/active-dir/a.md', dirname: '/active-dir' });

        const prewarmed = muya.prewarmDocument({
            id: 'tab-b',
            markdown: docB,
            context: { id: 'tab-b', pathname: '/other-dir/b.md', dirname: '/other-dir' },
            readOnly: false,
        });
        expect(prewarmed).toBe(true);
        expect(window.DIRNAME).toBe('/active-dir');
        expect(resolveSpy).toHaveBeenCalledWith('./diagram.excalidraw', '/other-dir/b.md');
        expect(muya.hasRetainedDocument('tab-b', docB, '/other-dir/b.md')).toBe(true);

        const activated = muya.activateDocument({
            id: 'tab-b',
            markdown: docB,
            context: { id: 'tab-b', pathname: '/other-dir/b.md', dirname: '/other-dir' },
            readOnly: false,
        });
        expect(activated.hotHit).toBe(true);
    });

    it('keeps a partially built idle document out of the pool until completed', () => {
        const active = 'Active\n\nSecond active paragraph';
        const muya = bootMuya(active);
        const livePage = muya.editor.scrollPage;
        const context = { id: 'active', pathname: '/active/a.md', dirname: '/active' };
        muya.bindActiveDocument(context.id, active, context);
        const options = {
            id: 'target',
            context: { id: 'target', pathname: '/target/b.md', dirname: '/target' },
            markdown: '# Target\n\nFirst target paragraph\n\nSecond target paragraph',
            readOnly: false,
        };
        const task = muya.createIdleDocumentPrewarm(options)!;
        const budget = vi.fn(() => 0).mockReturnValueOnce(5);

        expect(task.advance(budget)).toBe(false);
        expect(muya.editor.scrollPage).toBe(livePage);
        expect(muya.editor.documentContext).toBe(context);
        expect(muya.getMarkdown().trim()).toBe(active);
        expect(muya.hasRetainedDocument(options.id, options.markdown, options.context.pathname)).toBe(false);

        expect(task.advance(() => 20)).toBe(true);
        expect(muya.editor.scrollPage).toBe(livePage);
        expect(muya.activateDocument(options).hotHit).toBe(true);
        expect(muya.getMarkdown().trim()).toBe(options.markdown);
    });

    it('releases the detached page and its root listener on cancellation', () => {
        const muya = bootMuya('Active');
        muya.bindActiveDocument('active', 'Active', { id: 'active' });
        const count = muya.eventCenter.events.length;
        const options = {
            id: 'target',
            context: { id: 'target' },
            markdown: '# Target\n\nValue',
            readOnly: false,
        };
        const task = muya.createIdleDocumentPrewarm(options)!;
        expect(task.advance(vi.fn(() => 0).mockReturnValueOnce(5))).toBe(false);
        expect(muya.eventCenter.events.length).toBeGreaterThan(count);
        task.cancel();
        expect(muya.eventCenter.events).toHaveLength(count);
        expect(muya.hasRetainedDocument(options.id, options.markdown)).toBe(false);
        expect(muya.getMarkdown().trim()).toBe('Active');
    });

    it('finishes the matching partial page when the user activates its tab', () => {
        const muya = bootMuya('Active');
        muya.bindActiveDocument('active', 'Active', { id: 'active' });
        const options = {
            id: 'target',
            context: { id: 'target' },
            markdown: '# Target\n\nValue',
            readOnly: false,
        };
        const task = muya.createIdleDocumentPrewarm(options)!;
        expect(task.advance(vi.fn(() => 0).mockReturnValueOnce(5))).toBe(false);
        const parse = vi.spyOn(muya.editor.jsonState, 'markdownToState');
        const result = muya.activateDocument(options);
        expect(result.hotHit).toBe(false);
        expect(parse).not.toHaveBeenCalled();
        expect(muya.getMarkdown().trim()).toBe(options.markdown);
        task.cancel();
        expect(muya.domNode.querySelector('.mu-container h1')?.textContent).toContain('Target');
    });

    it('keeps an untitled note from borrowing the active directory during prewarm', () => {
        window.DIRNAME = '/active-dir';
        const resolvePreview = vi.fn(() => undefined);
        const muya = bootMuya('Active', { resolveImagePreview: resolvePreview });
        muya.bindActiveDocument('saved', 'Active', { id: 'saved', pathname: '/active-dir/a.md', dirname: '/active-dir' });
        const untitled = {
            id: 'untitled',
            context: { id: 'untitled', dirname: '' },
            markdown: '![drawing](./diagram.excalidraw)\n\n<div><img src="./sibling.png"></div>\n',
            readOnly: false,
        };
        expect(muya.prewarmDocument(untitled)).toBe(true);
        expect(muya.hasRetainedDocument(untitled.id, untitled.markdown, undefined, '/active-dir')).toBe(false);
        expect(muya.hasRetainedDocument(untitled.id, untitled.markdown, undefined, '')).toBe(true);
        expect(muya.activateDocument(untitled).hotHit).toBe(true);
        expect(resolvePreview).toHaveBeenCalledWith('./diagram.excalidraw', undefined);
        expect(muya.domNode.querySelector('.mu-html-preview img')?.getAttribute('src')).toBe('file://./sibling.png');
    });

    it('clears stale search highlights on hot-swapped tabs when returning after closing search', () => {
        const docA = 'needle in alpha paragraph';
        const docB = 'other tab content';
        const muya = bootMuya(docA);
        muya.bindActiveDocument('tab-a', docA, { id: 'tab-a' });

        muya.search('needle');
        expect(muya.domNode.querySelectorAll('.mu-highlight, .mu-selection').length).toBeGreaterThan(0);

        muya.activateDocument({ id: 'tab-b', markdown: docB, context: { id: 'tab-b' }, readOnly: false, searchOpen: true });
        muya.setSearchVisible(false);

        const backToA = muya.activateDocument({
            id: 'tab-a',
            markdown: docA,
            context: { id: 'tab-a' },
            readOnly: false,
            searchOpen: false,
        });
        expect(backToA.hotHit).toBe(true);
        expect(muya.domNode.querySelectorAll('.mu-highlight, .mu-selection').length).toBe(0);
    });

    it('resolves setCursorByOffset offscreen without replacing ScrollPage DOM nodes', () => {
        const doc = 'First line\n\nSecond line target';
        const muya = bootMuya(doc);
        const pageBefore = muya.editor.scrollPage;
        const domBefore = pageBefore?.domNode;

        muya.setCursorByOffset({
            anchor: { line: 2, ch: 7 },
            focus: { line: 2, ch: 7 },
        });

        expect(muya.editor.scrollPage).toBe(pageBefore);
        expect(muya.editor.scrollPage?.domNode).toBe(domBefore);
        const sel = muya.getSelectionState();
        expect(sel).not.toBeNull();
    });

    it('rewrites cached Mermaid SVG IDs without prefix collisions', () => {
        const svg = '<svg id="mu-mermaid-1"><style>#mu-mermaid-1 .node{fill:red}#mu-mermaid-10{fill:blue}</style><g id="mu-mermaid-1-node" filter="url(#mu-mermaid-1-shadow)" href="#mu-mermaid-1-def"/></svg>';
        const rewritten = rewriteMermaidSvgIds(svg, 'mu-mermaid-1', 'mu-mermaid-42');

        expect(rewritten).toContain('id="mu-mermaid-42"');
        expect(rewritten).toContain('#mu-mermaid-42 .node');
        expect(rewritten).toContain('#mu-mermaid-10{fill:blue}');
        expect(rewritten).toContain('id="mu-mermaid-42-node"');
        expect(rewritten).toContain('url(#mu-mermaid-42-shadow)');
        expect(rewritten).toContain('href="#mu-mermaid-42-def"');
    });
});
