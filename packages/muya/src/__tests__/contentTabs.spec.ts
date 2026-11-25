// @vitest-environment happy-dom
import type Parent from '../block/base/parent';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const instances: Muya[] = [];
const source = '<!-- tabs -->\n\n#### | Alpha\n\nFirst body.\n\n#### \\| Beta\n\nSecond body.\n\n#### Ordinary\n\nStill in Beta.\n\n<!-- /tabs -->\n\nOutside.\n';

function boot(markdown = source, readOnly = false) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown, readOnly });
    muya.init({ focus: false });
    instances.push(muya);
    return muya;
}

function blocks(muya: Muya): Parent[] {
    return muya.editor.scrollPage!.map(block => block as Parent);
}

function buttons(muya: Muya): HTMLButtonElement[] {
    return [...muya.domNode.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

afterEach(() => {
    instances.splice(0).forEach(muya => muya.destroy());
    document.getSelection()?.removeAllRanges();
});

describe('content tabs editing', () => {
    it('switches panels without changing source, history or block instances', () => {
        const muya = boot();
        const originalBlocks = blocks(muya);
        const hidden = (index: number) => muya.editor.contentTabs.isHidden(originalBlocks[index]);
        expect(buttons(muya).map(button => button.textContent)).toEqual(['Alpha', 'Beta']);
        expect(hidden(2)).toBe(false);
        expect(hidden(4)).toBe(true);
        expect(hidden(5)).toBe(true);
        buttons(muya)[1].click();
        expect(hidden(2)).toBe(true);
        expect(hidden(4)).toBe(false);
        expect(hidden(5)).toBe(false);
        expect(hidden(8)).toBe(false);
        expect(blocks(muya)).toEqual(originalBlocks);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
    });

    it('supports keyboard switching and read-only navigation', () => {
        const muya = boot(source, true);
        buttons(muya)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(buttons(muya)[1].getAttribute('aria-selected')).toBe('true');
        buttons(muya)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(buttons(muya)[0].getAttribute('aria-selected')).toBe('true');
        expect(muya.getMarkdown()).toBe(source);
    });

    it('focuses the tab bar when an imported group has no body blocks', () => {
        const muya = boot('<!-- tabs -->\n\n## | First\n\n## | Second\n\n<!-- /tabs -->');
        muya.focus();
        expect(document.activeElement).toBe(buttons(muya)[0]);
        expect(muya.domNode.querySelector('.mu-content-tabs-source')?.getAttribute('aria-pressed')).toBe('false');
        expect(muya.getHistory().stack.undo).toHaveLength(0);
    });

    it('reveals a hidden target for search and outline navigation', () => {
        const muya = boot();
        const target = blocks(muya)[6].firstContentInDescendant()!;
        target.setCursor(2, 2, true);
        expect(buttons(muya)[1].getAttribute('aria-selected')).toBe('true');
        expect(muya.editor.contentTabs.isHidden(target)).toBe(false);
        expect(muya.getTOC().map(item => item.content)).toEqual(['Alpha', 'Beta', 'Ordinary']);
    });

    it('edits a title and restores it through undo and redo', () => {
        const muya = boot();
        buttons(muya)[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const title = blocks(muya)[1].firstContentInDescendant()!;
        expect(muya.editor.contentTabs.isHidden(title)).toBe(true);
        expect(document.activeElement).toBe(muya.domNode.querySelector('.mu-content-tab-input'));
        muya.transact(() => {
            title.text = '#### | Renamed';
            title.update();
        });
        expect(buttons(muya)[0].textContent).toBe('Renamed');
        muya.undo();
        expect(buttons(muya)[0].textContent).toBe('Alpha');
        muya.redo();
        expect(buttons(muya)[0].textContent).toBe('Renamed');
    });

    it('closes the inline title editor when the selection moves into its body', () => {
        const muya = boot();
        buttons(muya)[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const heading = blocks(muya)[1];
        expect(muya.domNode.querySelector('.mu-content-tab-input')).not.toBeNull();
        expect(muya.editor.contentTabs.isHidden(heading)).toBe(true);
        blocks(muya)[2].firstContentInDescendant()!.setCursor(0, 0, true);
        expect(muya.domNode.querySelector('.mu-content-tab-input')).toBeNull();
        expect(muya.editor.contentTabs.isHidden(heading)).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('adds a selected tab at the end of the group in one undo step', () => {
        const muya = boot();
        const original = blocks(muya);
        muya.domNode.querySelector<HTMLButtonElement>('.mu-content-tabs-add')!.click();
        expect(buttons(muya).map(button => button.textContent)).toEqual(['Alpha', 'Beta', 'Tab 3']);
        expect(buttons(muya)[2].getAttribute('aria-selected')).toBe('true');
        expect(muya.getMarkdown()).toMatch(/#### \| Tab 3\n+<!-- \/tabs -->\n\nOutside\./);
        expect(blocks(muya).at(-1)).toBe(original.at(-1));
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        muya.undo();
        expect(muya.getMarkdown()).toBe(source);
        muya.redo();
        expect(buttons(muya)).toHaveLength(3);
    });

    it('chooses an unused default label and retains the group heading level', () => {
        const muya = boot('<!-- tabs -->\n\n## | Tab 1\n\nA\n\n## | Tab 3\n\nB\n\n<!-- /tabs -->');
        muya.domNode.querySelector<HTMLButtonElement>('.mu-content-tabs-add')!.click();
        expect(buttons(muya).map(button => button.textContent)).toEqual(['Tab 1', 'Tab 3', 'Tab 4']);
        expect(muya.getMarkdown()).toContain('## | Tab 4');
    });

    it('does not add a tab to a read-only document', () => {
        const muya = boot(source, true);
        muya.domNode.querySelector<HTMLButtonElement>('.mu-content-tabs-add')!.click();
        expect(muya.getMarkdown()).toBe(source);
        expect(buttons(muya)).toHaveLength(2);
    });

    it('adds to a nested group without changing its enclosing tabs', () => {
        const muya = boot('<!-- tabs -->\n\n## | Outer A\n\n<!-- tabs -->\n\n### | Inner A\n\nAlpha\n\n### | Inner B\n\nBeta\n\n<!-- /tabs -->\n\n## | Outer B\n\nGamma\n\n<!-- /tabs -->');
        const before = muya.getMarkdown();
        muya.domNode.querySelectorAll<HTMLButtonElement>('.mu-content-tabs-add')[1].click();
        expect(buttons(muya).map(button => button.textContent)).toEqual(['Outer A', 'Outer B', 'Inner A', 'Inner B', 'Tab 3']);
        expect(buttons(muya)[0].getAttribute('aria-selected')).toBe('true');
        expect(buttons(muya)[4].getAttribute('aria-selected')).toBe('true');
        expect(muya.getMarkdown()).toMatch(/### \| Tab 3\n+<!-- \/tabs -->\n\n## \| Outer B/);
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
    });

    it('adds inside a quoted group and undoes the nested document operations', () => {
        const muya = boot('> <!-- tabs -->\n>\n> ## | A\n>\n> Alpha\n>\n> <!-- /tabs -->');
        const before = muya.getMarkdown();
        muya.domNode.querySelector<HTMLButtonElement>('.mu-content-tabs-add')!.click();
        expect(buttons(muya).map(button => button.textContent)).toEqual(['A', 'Tab 2']);
        expect(muya.getMarkdown()).toContain('> ## | Tab 2');
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
    });

    it('restores ordinary content immediately after a boundary is edited', () => {
        const muya = boot();
        const end = blocks(muya)[7].firstContentInDescendant()!;
        muya.transact(() => {
            end.text = '<!-- unfinished -->';
            end.update();
        });
        expect(buttons(muya)).toHaveLength(0);
        expect(muya.domNode.querySelector('.mu-content-tabs-hidden')).toBeNull();
        muya.undo();
        expect(buttons(muya)).toHaveLength(2);
    });

    it('keeps nested quotes, lists and code out of the outer tab list', () => {
        const muya = boot('<!-- tabs -->\n\n## | A\n\n> ## | Quote\n\n- ## | List\n\n```md\n<!-- /tabs -->\n## | Code\n```\n\n## | B\n\nText\n\n<!-- /tabs -->');
        expect(buttons(muya).map(button => button.textContent)).toEqual(['A', 'B']);
    });

    it('skips inactive panels and boundary comments during caret navigation', () => {
        const muya = boot();
        const body = blocks(muya)[2].firstContentInDescendant()!;
        expect(body.nextContentInContext(true)?.text).toBe('Outside.');
        expect(blocks(muya)[8].firstContentInDescendant()!.previousContentInContext(true)).toBe(body);
    });

    it('expands source when a selection spans different panels', () => {
        const muya = boot();
        const first = blocks(muya)[2].firstContentInDescendant()!;
        const last = blocks(muya)[4].firstContentInDescendant()!;
        muya.editor.contentTabs.revealSelection(first, last);
        expect(muya.editor.contentTabs.isHidden(first)).toBe(false);
        expect(muya.editor.contentTabs.isHidden(last)).toBe(false);
    });

    it('shows raw boundaries and all panels with the local source button', () => {
        const muya = boot();
        muya.domNode.querySelector<HTMLButtonElement>('.mu-content-tabs-source')!.click();
        expect(muya.domNode.querySelector('.mu-content-tabs-hidden')).toBeNull();
        expect(muya.getMarkdown()).toBe(source);
    });

    it.each(['<!-- tabs -->\n\n## | Missing end', '## | Outside', '<!-- tabs -->\n\n## || Ordinary\n\n<!-- /tabs -->'])('keeps invalid or unrelated syntax ordinary: %j', (markdown) => {
        const muya = boot(markdown);
        expect(buttons(muya)).toHaveLength(0);
        expect(muya.domNode.querySelector('.mu-content-tabs-hidden')).toBeNull();
    });

    it('removes tab decorations when replacing the document', () => {
        const muya = boot();
        muya.setContent('Plain');
        expect(muya.domNode.querySelector('.mu-content-tabs-bar')).toBeNull();
        expect(muya.domNode.querySelector('.mu-content-tabs-end')).toBeNull();
        expect(muya.getMarkdown()).toBe('Plain\n');
    });

    it('preserves independent active tabs in nested groups', () => {
        const markdown = '<!-- tabs -->\n\n## | Outer A\n\n<!-- tabs -->\n\n### | Inner A\n\nAlpha\n\n### | Inner B\n\nBeta\n\n<!-- /tabs -->\n\n## | Outer B\n\nGamma\n\n<!-- /tabs -->';
        const muya = boot(markdown);
        const tabs = buttons(muya);
        expect(tabs.map(button => button.textContent)).toEqual(['Outer A', 'Outer B', 'Inner A', 'Inner B']);
        tabs[3].click();
        tabs[1].click();
        expect(muya.domNode.querySelectorAll<HTMLElement>('.mu-content-tabs-bar')[1].hidden).toBe(true);
        tabs[0].click();
        expect(muya.domNode.querySelectorAll<HTMLElement>('.mu-content-tabs-bar')[1].hidden).toBe(false);
        expect(tabs[3].getAttribute('aria-selected')).toBe('true');
        expect(muya.getMarkdown()).toContain('### | Inner B');
    });

    it('recognizes a complete group inside a quote without borrowing outer headings', () => {
        const muya = boot('> <!-- tabs -->\n>\n> ## | A\n>\n> Alpha\n>\n> ## | B\n>\n> Beta\n>\n> <!-- /tabs -->\n\n## | Outside');
        expect(buttons(muya).map(button => button.textContent)).toEqual(['A', 'B']);
        expect(muya.getTOC().map(item => item.content)).toEqual(['| Outside']);
    });

    it('uses reference definitions when displaying a tab label', () => {
        const muya = boot('<!-- tabs -->\n\n## | [Title][ref]\n\nBody\n\n<!-- /tabs -->\n\n[ref]: https://example.com');
        expect(buttons(muya)[0].textContent).toBe('Title');
    });

    it('search reveals an inactive panel even without moving the editing selection', () => {
        const muya = boot();
        muya.search('Second body', { selectHighlight: false });
        expect(buttons(muya)[1].getAttribute('aria-selected')).toBe('true');
        expect(muya.editor.contentTabs.isHidden(blocks(muya)[4])).toBe(false);
    });

    it('keeps the caret visible when an ordinary heading becomes a new tab', () => {
        const muya = boot('<!-- tabs -->\n\n## | A\n\nBody\n\n#### Ordinary\n\nNew body\n\n## | B\n\nOther body\n\n<!-- /tabs -->');
        const heading = blocks(muya)[3].firstContentInDescendant()!;
        heading.setCursor(5, 5, true);
        muya.transact(() => {
            heading.text = '#### | New';
            heading.update();
        });
        expect(buttons(muya).map(button => button.textContent)).toEqual(['A', 'New', 'B']);
        expect(buttons(muya)[1].getAttribute('aria-selected')).toBe('true');
        expect(muya.editor.contentTabs.isHidden(heading)).toBe(false);
    });
});
