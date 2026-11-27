// @vitest-environment happy-dom

import type { IMuyaOptions } from '../../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResources } from '../../inline/resources/images';
import { Muya } from '../../muya';
import { SelectionType } from '../../selection/types';
import { encodeInlineDrawing, INLINE_DRAWING_DATA_PREFIX } from '../../utils/diagram/drawingData';
import { findEmbeddedDrawings } from '../../utils/diagram/drawingSource';
import { loadImage } from '../../utils/image';

vi.mock('../../utils/image', async original => ({
    ...await original<typeof import('../../utils/image')>(),
    loadImage: vi.fn(),
}));

const booted: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

function bootEditor(markdown: string, options: Partial<IMuyaOptions> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, ...options });
    muya.init();
    booted.push(muya);
    return muya;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function sceneJson(id: string): string {
    return JSON.stringify({
        type: 'excalidraw',
        version: 2,
        elements: [{ id, type: 'rectangle' }],
        appState: {},
        files: {},
    });
}

function inlineMarkup(scene: string, alt = 'Embedded drawing'): string {
    return `![${alt}](${encodeInlineDrawing(scene)})`;
}

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
    vi.mocked(loadImage).mockReset();
});

describe('preview ownership across retained pages', () => {
    it.each(['hidden', 'parked'])('commits results after returning to a %s page', async (mode) => {
        const nextImage = deferred<string>();
        const invalid = deferred<string>();
        const load = vi.fn(() => nextImage.promise);
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 20, height: 20 }));
        const muya = bootEditor('Anchor', {
            resolveImagePreview: src => ({ key: src, load }),
            embeddedDrawing: { preview: () => invalid.promise, label: () => 'drawing', open: () => {} },
        });
        const anchor = { id: 'a', context: { id: 'a' }, markdown: 'Anchor', readOnly: false };
        muya.bindActiveDocument(anchor.id, anchor.markdown, anchor.context);
        const markdown = `${inlineMarkup(sceneJson('held'))}\n\n\`\`\`excalidraw\ninvalid\n\`\`\``;
        const opts = { id: 'b', context: { id: 'b' }, markdown, readOnly: false };
        expect(muya.prewarmDocument(opts)).toBe(true);
        await Promise.resolve();
        expect(load).not.toHaveBeenCalled();
        expect(muya.activateDocument(opts).hotHit).toBe(true);
        const page = muya.editor.scrollPage!;
        await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
        if (mode === 'hidden')
            muya.setViewportSuspended(true);
        else
            muya.activateDocument(anchor);
        nextImage.resolve('https://example.com/new.png');
        invalid.reject(new Error('invalid'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(page.domNode!.querySelector('.mu-inline-drawing img')).toBeNull();
        expect(page.domNode!.querySelector('.mu-embedded-drawing-button')?.textContent).toContain('Loading');
        if (mode === 'hidden')
            muya.setViewportSuspended(false);
        else
            expect(muya.activateDocument(opts).hotHit).toBe(true);
        await vi.waitFor(() => {
            expect(page.domNode!.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('https://example.com/new.png');
            expect(page.domNode!.querySelector('.mu-embedded-drawing-button')?.textContent).toContain('Invalid');
        });
        expect(muya.editor.scrollPage).toBe(page);
    });

    it('updates both retained occurrences of the same linked drawing', async () => {
        const key = '/abs/shared.excalidraw';
        const oldUrl = 'https://example.com/old.png';
        const newUrl = 'https://example.com/new.png';
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 20, height: 20 }));
        const markdown = '![drawing](shared.excalidraw)\n\n![reference][shared]\n\n[shared]: shared.excalidraw';
        const muya = bootEditor(markdown, { resolveImagePreview: () => ({ key, load: async () => oldUrl }) });
        const a = { id: 'a', context: { id: 'a' }, markdown, readOnly: false };
        const b = { ...a, id: 'b', context: { id: 'b' } };
        muya.bindActiveDocument(a.id, markdown, a.context);
        const images = () => [...muya.domNode.querySelectorAll('.mu-image-container img, [data-preview-src] + img')]
            .map(img => img.getAttribute('src'));
        await vi.waitFor(() => expect(images()).toEqual([oldUrl, oldUrl]));
        muya.activateDocument(b);
        await vi.waitFor(() => expect(images()).toEqual([oldUrl, oldUrl]));
        expect(muya.activateDocument(a).hotHit).toBe(true);
        expect(await muya.refreshImagePreview(key, async () => newUrl)).toBe(true);
        expect(images()).toEqual([newUrl, newUrl]);
        expect(muya.activateDocument(b).hotHit).toBe(true);
        expect(await muya.refreshImagePreview(key, async () => newUrl)).toBe(true);
        expect(images()).toEqual([newUrl, newUrl]);
    });
});

afterEach(() => {
    while (booted.length)
        booted.pop()!.destroy();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

describe('content.replaceTextRange', () => {
    it('replaces ranges with emoji prefixes and replays cleanly through undo/redo', () => {
        const muya = bootEditor('👨‍👩‍👧‍👦 before old-token after\n');
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        const start = content.text.indexOf('old-token');
        const end = start + 'old-token'.length;

        muya.editor.history.cutoff();
        muya.transact(() => {
            content.replaceTextRange(start, end, 'new-longer-token');
        });
        muya.editor.history.cutoff();

        expect(muya.getMarkdown().trim()).toBe('👨‍👩‍👧‍👦 before new-longer-token after');

        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('👨‍👩‍👧‍👦 before old-token after');

        muya.redo();
        expect(muya.getMarkdown().trim()).toBe('👨‍👩‍👧‍👦 before new-longer-token after');
    });
});

describe('muya.updateEmbeddedDrawing', () => {
    it('returns false with zero side effects when verification fails', () => {
        const s1 = sceneJson('a');
        const s2 = sceneJson('b');
        const initial = `Lead\n\n${inlineMarkup(s1)}\n\nTail\n`;
        const muya = bootEditor(initial);
        const beforeMarkdown = muya.getMarkdown();
        const leadDom = muya.domNode.querySelector('.mu-paragraph')!;

        const appliedWrongSource = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'inline',
            expectedSource: sceneJson('mismatch'),
            nextSource: s2,
        });
        const appliedWrongKind = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'fence',
            expectedSource: s1,
            nextSource: s2,
        });

        expect(appliedWrongSource).toBe(false);
        expect(appliedWrongKind).toBe(false);
        expect(muya.getMarkdown()).toBe(beforeMarkdown);
        expect(muya.editor.history.canUndo()).toBe(false);
        expect(muya.domNode.querySelector('.mu-paragraph')).toBe(leadDom);
    });

    it('updates an inline drawing in place without rebuilding sibling blocks or entering loading state', async () => {
        const s1 = sceneJson('v1');
        const s2 = sceneJson('v2');
        const src1 = encodeInlineDrawing(s1);
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 320, height: 180 }));

        const muya = bootEditor(`Lead paragraph\n\nBefore ${inlineMarkup(s1)} After\n\nTail paragraph\n`, {
            resolveImagePreview: src => src.startsWith(INLINE_DRAWING_DATA_PREFIX)
                ? { key: src, load: async () => src === src1 ? 'data:image/png;base64,OLD' : 'data:image/png;base64,DEFAULT' }
                : undefined,
        });

        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');
        });

        const paragraphs = muya.domNode.querySelectorAll('.mu-paragraph');
        const leadDom = paragraphs[0];
        const tailDom = paragraphs[2];
        const wrapper = muya.domNode.querySelector<HTMLElement>('.mu-inline-drawing')!;

        let sawLoading = false;
        const observer = new MutationObserver(() => {
            if (muya.domNode.querySelector('.mu-image-loading'))
                sawLoading = true;
        });
        observer.observe(muya.domNode, { attributes: true, childList: true, subtree: true });

        const nextExport = deferred<string>();
        const applied = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'inline',
            expectedSource: s1,
            expectedEncodedSrc: src1,
            expectedMarkup: inlineMarkup(s1),
            nextSource: s2,
            previewLoader: () => nextExport.promise,
            preventScroll: true,
            preserveFocus: true,
        });

        expect(applied).toBe(true);
        expect(muya.getMarkdown().trim()).toBe(`Lead paragraph\n\nBefore ${inlineMarkup(s2)} After\n\nTail paragraph`);
        // Old bitmap remains visible while the next PNG exports.
        expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');
        expect(muya.domNode.querySelector('.mu-image-loading')).toBeNull();

        nextExport.resolve('data:image/png;base64,NEW');
        await vi.waitFor(() => {
            expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,NEW');
        });

        observer.disconnect();
        expect(sawLoading).toBe(false);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')[0]).toBe(leadDom);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')[2]).toBe(tailDom);

        // Incremental undo keeps unrelated blocks intact and avoids loading collapse.
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe(`Lead paragraph\n\nBefore ${inlineMarkup(s1)} After\n\nTail paragraph`);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')[0]).toBe(leadDom);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')[2]).toBe(tailDom);
        expect(muya.domNode.querySelector('.mu-image-loading')).toBeNull();
        expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');
    });

    it('recovers when targetBlock.update() or active search runs mid-flight and uses previewLoader', async () => {
        const s1 = sceneJson('search-1');
        const s2 = sceneJson('search-2');
        const src1 = encodeInlineDrawing(s1);
        const src2 = encodeInlineDrawing(s2);
        const defaultLoader = vi.fn(async (src: string) =>
            src === src1 ? 'data:image/png;base64,OLD' : 'data:image/png;base64,WRONG_DEFAULT');
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 320, height: 180 }));

        const muya = bootEditor(`needle ${inlineMarkup(s1)} end\n`, {
            resolveImagePreview: src => src.startsWith(INLINE_DRAWING_DATA_PREFIX)
                ? { key: src, load: () => defaultLoader(src) }
                : undefined,
        });

        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');
        });

        // Open visible search matching text in the same paragraph.
        muya.search('needle', { selectHighlight: false });
        defaultLoader.mockClear();

        const customExport = deferred<string>();
        const applied = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'inline',
            expectedSource: s1,
            expectedEncodedSrc: src1,
            expectedMarkup: inlineMarkup(s1),
            nextSource: s2,
            previewLoader: () => customExport.promise,
            preventScroll: true,
            preserveFocus: true,
        });

        expect(applied).toBe(true);
        // Round 4 §4.2: search refresh ran synchronously inside transact without loading collapse or defaultLoader.
        expect(defaultLoader).not.toHaveBeenCalled();
        expect(muya.domNode.querySelector('.mu-image-loading')).toBeNull();
        expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');

        // Another explicit block.update() before the PNG resolves still keeps old bitmap and resolves to new PNG.
        muya.editor.scrollPage!.firstContentInDescendant()!.update();
        expect(muya.domNode.querySelector('.mu-image-loading')).toBeNull();

        customExport.resolve('data:image/png;base64,FROM_PREVIEW_LOADER');
        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,FROM_PREVIEW_LOADER');
        });
        expect(muya.editor.inlineEngine.renderer.images.get(src2)?.url).toBe('data:image/png;base64,FROM_PREVIEW_LOADER');

        // Round 5 §5.1: returning to a cached LRU key must not override it with oldUrl preview.
        const backToS1 = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'inline',
            expectedSource: s2,
            expectedEncodedSrc: src2,
            expectedMarkup: inlineMarkup(s2),
            nextSource: s1,
            preventScroll: true,
            preserveFocus: true,
        });
        expect(backToS1).toBe(true);
        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-inline-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,OLD');
        });
    });

    it('keeps fenced drawing image visible across updates and preserves it on preview failure', async () => {
        const s1 = sceneJson('fence-1');
        const s2 = sceneJson('fence-2');
        const s3 = sceneJson('fence-3');
        const preview = vi.fn(async (code: string) => `data:image/png;base64,${code.includes('fence-1') ? 'F1' : 'F_DEFAULT'}`);

        const muya = bootEditor(`Lead\n\n> \`\`\`excalidraw\n> ${s1}\n> \`\`\`\n\nTail\n`, {
            embeddedDrawing: {
                preview,
                open: vi.fn(),
                label: () => 'Embedded drawing',
            },
        });

        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-embedded-drawing-button img')?.getAttribute('src')).toBe('data:image/png;base64,F1');
        });

        const button = muya.domNode.querySelector<HTMLButtonElement>('.mu-embedded-drawing-button')!;
        const nextExport = deferred<string>();
        const applied = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'fence',
            expectedSource: s1,
            nextSource: s2,
            previewLoader: () => nextExport.promise,
        });

        expect(applied).toBe(true);
        expect(button.textContent).not.toContain('Loading...');
        expect(button.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,F1');

        nextExport.resolve('data:image/png;base64,F2');
        await vi.waitFor(() => {
            expect(button.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,F2');
        });
        expect(muya.getMarkdown()).toBe(`Lead\n\n> \`\`\`excalidraw\n> ${s2}\n> \`\`\`\n\nTail\n`);

        // Failure on a warm fenced drawing must keep the existing image instead of replacing it with error text.
        const appliedFail = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'fence',
            expectedSource: s2,
            nextSource: s3,
            previewLoader: () => Promise.reject(new Error('export failed')),
        });
        expect(appliedFail).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(button.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,F2');
        expect(button.textContent).not.toContain('Invalid Diagram Code');
    });

    it('shows Invalid Diagram Code when cold-rendering a fenced drawing fails', async () => {
        const s1 = sceneJson('cold-fail');
        const muya = bootEditor(`\`\`\`excalidraw\n${s1}\n\`\`\`\n`, {
            embeddedDrawing: {
                preview: () => Promise.reject(new Error('bad scene')),
                open: vi.fn(),
                label: () => 'Embedded drawing',
            },
        });

        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-embedded-drawing-button')?.textContent).toContain('Invalid Diagram Code');
        });
    });

    it('updates a Markdown inline drawing when preceded by an HTML embedded drawing img', async () => {
        const sHtml = sceneJson('html-one');
        const sMd = sceneJson('md-one');
        const sNext = sceneJson('md-two');
        const htmlTag = `<img src="${encodeInlineDrawing(sHtml)}" alt="html" />`;
        const mdImage = inlineMarkup(sMd);
        const markdown = `${htmlTag}\n\n${mdImage}\n`;
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 240, height: 120 }));

        const muya = bootEditor(markdown, {
            resolveImagePreview: src => src.startsWith(INLINE_DRAWING_DATA_PREFIX)
                ? { key: src, load: async () => 'data:image/png;base64,OK' }
                : undefined,
        });

        const drawings = findEmbeddedDrawings(markdown);
        expect(drawings).toHaveLength(1);
        const applied = muya.updateEmbeddedDrawing({
            renderedIndex: 0,
            expectedKind: 'inline',
            expectedSource: sMd,
            expectedEncodedSrc: encodeInlineDrawing(sMd),
            expectedMarkup: mdImage,
            nextSource: sNext,
        });

        expect(applied).toBe(true);
        expect(muya.getMarkdown()).toBe(`${htmlTag}\n\n${inlineMarkup(sNext)}\n`);
    });

    it('shifts logical text selection after the edited inline drawing without touching native focus', async () => {
        const s1 = sceneJson('short');
        const s2 = sceneJson('a-much-longer-scene-identifier-1234567890');
        const initial = `Start ${inlineMarkup(s1)} Tail\n`;
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 240, height: 120 }));

        const muya = bootEditor(initial, {
            resolveImagePreview: src => src.startsWith(INLINE_DRAWING_DATA_PREFIX)
                ? { key: src, load: async () => 'data:image/png;base64,OK' }
                : undefined,
        });

        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        const tailOffset = content.text.indexOf('Tail') + 2;
        content.setCursor(tailOffset, tailOffset, true);

        const external = document.createElement('textarea');
        document.body.append(external);
        external.focus();
        const addRangeSpy = vi.spyOn(Selection.prototype, 'addRange');
        const focusSpy = vi.spyOn(muya.domNode, 'focus');

        try {
            const delta = encodeInlineDrawing(s2).length - encodeInlineDrawing(s1).length;
            const applied = muya.updateEmbeddedDrawing({
                renderedIndex: 0,
                expectedKind: 'inline',
                expectedSource: s1,
                expectedEncodedSrc: encodeInlineDrawing(s1),
                expectedMarkup: inlineMarkup(s1),
                nextSource: s2,
                preventScroll: true,
                preserveFocus: true,
            });
            expect(applied).toBe(true);
            expect(addRangeSpy).not.toHaveBeenCalled();
            expect(focusSpy).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(external);
            expect(muya.getSelectionState()).toEqual({
                kind: SelectionType.TEXT,
                anchor: { path: [0, 'text'], offset: tailOffset + delta },
                focus: { path: [0, 'text'], offset: tailOffset + delta },
            });
        }
        finally {
            addRangeSpy.mockRestore();
            focusSpy.mockRestore();
            external.remove();
        }
    });
});

describe('imageResources pinned LRU and linked revalidate', () => {
    it('pins in-document inline drawings and evicts only detached history keys beyond 24', async () => {
        const pinned = new Set<string>();
        const resources = new ImageResources(src => pinned.has(src));
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 100, height: 100 }));

        // 25 live inline drawings must all remain cached.
        const liveKeys: string[] = [];
        for (let i = 0; i < 25; i++) {
            const key = encodeInlineDrawing(sceneJson(`live-${i}`));
            pinned.add(key);
            liveKeys.push(key);
            await resources.request(key, false, async () => `data:image/png;base64,LIVE_${i}`);
        }
        // 30 detached history keys: only the newest 24 detached entries remain.
        const detachedKeys: string[] = [];
        for (let i = 0; i < 30; i++) {
            const key = encodeInlineDrawing(sceneJson(`hist-${i}`));
            detachedKeys.push(key);
            await resources.request(key, false, async () => `data:image/png;base64,HIST_${i}`);
        }

        for (const key of liveKeys)
            expect(resources.get(key)?.isSuccess).toBe(true);
        for (let i = 0; i < 6; i++)
            expect(resources.get(detachedKeys[i])).toBeUndefined();
        for (let i = 6; i < 30; i++)
            expect(resources.get(detachedKeys[i])?.isSuccess).toBe(true);
    });

    it('revalidates a linked drawing in place without clearing unrelated images', async () => {
        vi.mocked(loadImage).mockImplementation(async url => ({ url, width: 200, height: 140 }));
        let linkedPng = 'data:image/png;base64,LINKED_V1';
        const muya = bootEditor('![Linked](./diagram.excalidraw)\n\n![Photo](https://example.com/photo.png)\n', {
            resolveImagePreview: src => src === './diagram.excalidraw'
                ? { key: '/abs/diagram.excalidraw', load: async () => linkedPng }
                : undefined,
        });

        await vi.waitFor(() => {
            expect(muya.domNode.querySelector('.mu-linked-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,LINKED_V1');
            expect(muya.domNode.querySelectorAll('.mu-image-container img')).toHaveLength(2);
        });

        const photoImg = muya.domNode.querySelectorAll('.mu-image-container img')[1];

        // Unchanged PNG short-circuits with zero DOM writes.
        const unchanged = await muya.refreshImagePreview('/abs/diagram.excalidraw', async () => linkedPng);
        expect(unchanged).toBe(false);

        // Changed PNG swaps only the linked drawing while keeping unrelated photo untouched.
        linkedPng = 'data:image/png;base64,LINKED_V2';
        const changed = await muya.refreshImagePreview('/abs/diagram.excalidraw', async () => linkedPng);
        expect(changed).toBe(true);
        expect(muya.domNode.querySelector('.mu-image-loading')).toBeNull();
        expect(muya.domNode.querySelector('.mu-linked-drawing img')?.getAttribute('src')).toBe('data:image/png;base64,LINKED_V2');
        expect(muya.domNode.querySelectorAll('.mu-image-container img')[1]).toBe(photoImg);
    });
});
