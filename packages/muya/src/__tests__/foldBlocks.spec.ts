// @vitest-environment happy-dom
import type Parent from '../block/base/parent';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceBlockByLabel } from '../block/blockTransforms';
import { Muya } from '../muya';

const source = '<!-- fold -->\n\n### Retry steps\n\nRead the response.\n\n<!-- /fold -->\n';
const instances: Muya[] = [];

function boot(markdown = source, readOnly = false) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown, readOnly });
    muya.init({ focus: false });
    instances.push(muya);
    return muya;
}

function toggle(muya: Muya): HTMLButtonElement {
    return muya.domNode.querySelector<HTMLButtonElement>('.mu-fold-block-toggle')!;
}

afterEach(() => {
    for (const muya of instances.splice(0))
        muya.destroy();
    document.getSelection()?.removeAllRanges();
});

describe('fold block editing', () => {
    it('toggles the current view in read-only mode and writes no document edit', () => {
        const muya = boot(source, true);
        const body = muya.editor.scrollPage!.find(2)!;
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('false');
        expect(muya.editor.foldBlocks.isHidden(body)).toBe(true);
        toggle(muya).click();
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('true');
        expect(muya.editor.foldBlocks.isHidden(body)).toBe(false);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
    });

    it('applies the stored default on reload independently of the current view', () => {
        const muya = boot();
        muya.domNode.querySelector<HTMLButtonElement>('.mu-fold-block-actions button[aria-pressed]')!.click();
        const saved = source.replace('<!-- fold -->', '<!-- fold open -->');
        expect(muya.getMarkdown()).toBe(saved);
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('false');
        muya.undo();
        expect(muya.getMarkdown()).toBe(source);
        muya.redo();
        expect(muya.getMarkdown()).toBe(saved);
        muya.setContent(saved);
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('true');
    });

    it('focuses the disclosure when a collapsed fold is the entire document', () => {
        const muya = boot();
        muya.focus();
        expect(document.activeElement).toBe(toggle(muya));
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('false');
    });

    it('reveals a nested search or navigation target and retains its heading in the outline', () => {
        const muya = boot(source.replace('Read the response.', '<!-- fold -->\n\n#### Inner\n\nRead the response.\n\n<!-- /fold -->'));
        const body = (muya.editor.scrollPage!.find(4) as Parent).firstContentInDescendant()!;
        body.setCursor(0, 0, true);
        expect([...muya.domNode.querySelectorAll('.mu-fold-block-toggle')].map(button => button.getAttribute('aria-expanded')))
            .toEqual(['true', 'true']);
        expect(muya.getTOC().map(item => item.content)).toEqual(['Retry steps', 'Inner']);
    });

    it('inserts an editable title and enters its body with Enter', () => {
        const muya = boot('/fold');
        const block = muya.editor.scrollPage!.firstChild!;
        if (!block.isParent())
            throw new Error('Expected a paragraph block');
        replaceBlockByLabel({ muya, block, label: 'fold-block' });
        const title = (muya.editor.scrollPage!.find(1) as Parent).firstContentInDescendant()!;
        expect(muya.editor.activeContentBlock).toBe(title);
        expect(title.getCursor()?.start.offset).toBe(4);
        title.domNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(toggle(muya).getAttribute('aria-expanded')).toBe('true');
        expect(muya.getMarkdown()).toContain('<!-- fold -->\n\n### Fold block');
        expect(muya.getMarkdown()).toContain('<!-- /fold -->');
    });
});
