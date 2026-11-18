import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type { Muya } from '../muya';
import type { TSelection } from '../selection/types';
import { isHiddenByFold } from '../block/folding';
import { ScrollPage } from '../block/scrollPage';
import { parseInline } from '../inline/parser/lexer';
import { tokensToPlainText } from '../inline/projection';
import { SelectionType } from '../selection/types';
import { atxHeadingBodyRange } from '../state/headings';
import { findFoldBlockGroups, foldBlockMarker } from '../utils/foldBlocks';

interface IFoldView {
    start: Parent;
    title: Parent;
    end: Parent;
    body: Parent[];
    open: boolean;
    defaultOpen: boolean;
    editingTitle: boolean;
    showSource: boolean;
    header: HTMLDivElement;
    toggle: HTMLButtonElement;
    menu: HTMLDetailsElement;
    defaultButton: HTMLButtonElement;
}

const HIDDEN = 'mu-fold-block-hidden';
const SOURCE = 'mu-fold-block-source';

function isHeading(block: Parent): boolean {
    return block.blockName === 'atx-heading' || block.blockName === 'setext-heading';
}

function before(a: Node, b: Node): boolean {
    return a === b || Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** A view over ordinary comment, heading, and body blocks. Only the author's default is stored in Markdown. */
export class FoldBlocks {
    private _groups = new Map<Parent, IFoldView>();
    private _hidden = new Set<TreeNode>();
    private _hiddenBody = new Set<TreeNode>();
    private _source = new Set<TreeNode>();

    constructor(private _muya: Muya) {
        const { domNode, eventCenter } = _muya;
        eventCenter.attachDOMEvent(domNode, 'keydown', event => this._keydown(event));
        eventCenter.on('selection-change', ({ selection }) => this._selectionChanged(selection));
    }

    get hasGroups(): boolean {
        return this._groups.size > 0;
    }

    refresh(): void {
        const root = this._muya.editor.scrollPage;
        if (!root)
            return;
        const blocks = root.map(block => block).filter(block => block.isParent());
        const descriptors = blocks.map(block => ({
            marker: block.blockName === 'html-block' ? foldBlockMarker(block.firstContentInDescendant()?.text ?? '') : undefined,
            heading: isHeading(block),
        }));
        const groups = findFoldBlockGroups(descriptors);
        if (!groups.length && !this._groups.size)
            return;
        const valid = new Set<Parent>();
        const labels = this._muya.editor.inlineEngine.collectReferenceDefinitions();
        for (const { start, title, end, defaultOpen } of groups) {
            const opener = blocks[start];
            const heading = blocks[title];
            const group = this._groups.get(opener) ?? this._create(opener, heading, blocks[end], defaultOpen);
            group.editingTitle = group.editingTitle && heading === group.title;
            group.title = heading;
            group.end = blocks[end];
            group.body = blocks.slice(title + 1, end);
            group.defaultOpen = defaultOpen;
            valid.add(opener);

            const profile = heading.blockName === 'atx-heading' ? 'atx-heading' : 'setext-heading';
            const text = heading.firstContentInDescendant()?.text ?? '';
            const tokens = parseInline(text, { profile, labels, options: this._muya.options });
            const label = tokensToPlainText(tokens).trim() || this._muya.i18n.t('Fold block');
            if (group.toggle.textContent !== label)
                group.toggle.textContent = label;
            if (opener.domNode!.previousElementSibling !== group.header)
                opener.domNode!.before(group.header);
        }

        for (const [opener, group] of this._groups) {
            if (!valid.has(opener)) {
                group.header.remove();
                this._groups.delete(opener);
            }
        }
        this._applyVisibility();
    }

    private _create(start: Parent, title: Parent, end: Parent, defaultOpen: boolean): IFoldView {
        const document = start.domNode!.ownerDocument;
        const { i18n } = this._muya;
        const header = document.createElement('div');
        header.className = 'mu-fold-block-header';
        header.contentEditable = 'false';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'mu-fold-block-toggle';
        const menu = document.createElement('details');
        menu.className = 'mu-fold-block-settings';
        const summary = document.createElement('summary');
        summary.textContent = '⋯';
        summary.setAttribute('aria-label', i18n.t('Fold options'));
        const actions = document.createElement('div');
        actions.className = 'mu-fold-block-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = i18n.t('Edit fold title');
        const defaultButton = document.createElement('button');
        defaultButton.type = 'button';
        defaultButton.textContent = i18n.t('Open by default');
        actions.append(edit, defaultButton);
        menu.append(summary, actions);
        header.append(toggle, menu);

        const group: IFoldView = {
            start,
            title,
            end,
            defaultOpen,
            open: defaultOpen,
            editingTitle: false,
            showSource: false,
            body: [],
            header,
            toggle,
            menu,
            defaultButton,
        };
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            this._muya.flush();
            this._muya.editor.activeContentBlock = null;
            this._muya.editor.selection.clear();
            group.open = !group.open;
            group.editingTitle = false;
            group.showSource = false;
            menu.open = false;
            this._applyVisibility();
        });
        edit.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.open = false;
            this.editTitle(group.title);
        });
        defaultButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this._toggleDefault(group);
        });

        this._groups.set(start, group);
        return group;
    }

    private _toggleDefault(group: IFoldView): void {
        const content = group.start.firstContentInDescendant();
        if (!this._muya.canMutate || !content?.outMostBlock)
            return;
        const marker = group.defaultOpen ? '<!-- fold -->' : '<!-- fold open -->';
        this._muya.transact(() => {
            content.text = marker;
            content.update();
        });
        group.menu.open = false;
        group.toggle.focus({ preventScroll: true });
    }

    private _applyVisibility(): void {
        for (const block of this._hidden)
            block.domNode?.classList.remove(HIDDEN);
        for (const block of this._source)
            block.domNode?.classList.remove(SOURCE);
        this._hidden.clear();
        this._hiddenBody.clear();
        this._source.clear();

        for (const group of this._groups.values()) {
            if (group.showSource) {
                this._source.add(group.start);
                this._source.add(group.end);
            }
            else {
                this._hidden.add(group.start);
                this._hidden.add(group.end);
                if (!group.editingTitle)
                    this._hidden.add(group.title);
            }
            if (!group.open && !group.showSource) {
                for (const block of group.body) {
                    this._hidden.add(block);
                    this._hiddenBody.add(block);
                }
            }
            group.toggle.setAttribute('aria-expanded', String(group.open));
            group.defaultButton.setAttribute('aria-pressed', String(group.defaultOpen));
        }
        for (const block of this._hidden)
            block.domNode?.classList.add(HIDDEN);
        for (const block of this._source)
            block.domNode?.classList.add(SOURCE);
        this._muya.editor.contentTabs.refreshBarVisibility();
    }

    refreshHeaderVisibility(): void {
        for (const group of this._groups.values()) {
            group.header.hidden = group.editingTitle || group.showSource || this._hiddenBody.has(group.start)
                || isHiddenByFold(group.start) || this._muya.editor.contentTabs.isHidden(group.start);
            if (group.header.hidden)
                group.menu.open = false;
        }
    }

    isHidden(block: TreeNode): boolean {
        const outer = block.outMostBlock;
        return !!outer && this._hidden.has(outer);
    }

    visibleToggleFor(block: Content): HTMLButtonElement | undefined {
        const outer = block.outMostBlock;
        const group = [...this._groups.values()].find(group => !group.header.hidden && (
            outer === group.start || outer === group.title || outer === group.end || (outer && group.body.includes(outer))
        ));
        return group?.toggle;
    }

    reveal(block: TreeNode): void {
        const outer = block.outMostBlock;
        if (!outer || !this._hidden.has(outer))
            return;
        for (const group of this._groups.values()) {
            if (outer === group.start || outer === group.end) {
                group.showSource = true;
                group.open = true;
            }
            else if (outer === group.title) {
                group.editingTitle = true;
            }
            else if (group.body.includes(outer)) {
                group.open = true;
            }
        }
        this._applyVisibility();
    }

    revealSelection(anchor: TreeNode, focus: TreeNode): void {
        const first = anchor.outMostBlock;
        const last = focus.outMostBlock;
        if (!first?.domNode || !last?.domNode || first === last || !this._groups.size)
            return;
        const [start, end] = before(first.domNode, last.domNode) ? [first.domNode, last.domNode] : [last.domNode, first.domNode];
        let changed = false;
        for (const group of this._groups.values()) {
            // A native selection crossing a boundary needs the original text visible.
            if (group.body.includes(first) && group.body.includes(last))
                continue;
            if (!group.showSource && before(start, group.end.domNode!) && before(group.start.domNode!, end)) {
                group.showSource = true;
                changed = true;
            }
        }
        if (changed)
            this._applyVisibility();
    }

    editTitle(heading: Parent): void {
        if (!this._muya.canMutate)
            return;
        let group = [...this._groups.values()].find(group => group.title === heading);
        if (!group) {
            this.refresh();
            group = [...this._groups.values()].find(group => group.title === heading);
        }
        const content = heading.firstContentInDescendant();
        if (!group || !content)
            return;
        group.editingTitle = true;
        group.showSource = false;
        this._applyVisibility();
        const range = heading.blockName === 'atx-heading'
            ? atxHeadingBodyRange(content.text)
            : { start: 0, end: content.text.length };
        content.setCursor(range.start, range.end, true);
    }

    private _selectionChanged(selection: TSelection | null): void {
        const text = selection?.kind === SelectionType.TEXT ? selection : undefined;
        if (text && text.context.anchorBlock !== text.context.focusBlock)
            return;
        const active = text?.context.anchorBlock.outMostBlock;
        let changed = false;
        for (const group of this._groups.values()) {
            if (group.editingTitle && active !== group.title) {
                group.editingTitle = false;
                changed = true;
            }
            if (group.showSource && active !== group.start && active !== group.end) {
                group.showSource = false;
                if (active === group.title)
                    group.editingTitle = true;
                else if (active && group.body.includes(active))
                    group.open = true;
                changed = true;
            }
        }
        if (changed)
            this._applyVisibility();
    }

    private _enterBody(group: IFoldView): void {
        group.open = true;
        group.editingTitle = false;
        this._applyVisibility();
        let body = group.body[0]?.firstContentInDescendant();
        if (!body) {
            const paragraph = ScrollPage.loadBlock('paragraph').create(this._muya, { name: 'paragraph', text: '' });
            this._muya.transact(() => group.title.parent!.insertAfter(paragraph, group.title));
            body = paragraph.firstContentInDescendant();
        }
        body?.setCursor(0, 0, true);
    }

    private _keydown(event: Event): void {
        if (!(event instanceof KeyboardEvent) || event.defaultPrevented || event.isComposing
            || this._muya.editor.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !this._muya.canMutate) {
            return;
        }
        const active = this._muya.editor.activeContentBlock;
        const title = event.target instanceof Element ? event.target.closest('.mu-fold-block-toggle') : null;
        const group = [...this._groups.values()].find(group => title === group.toggle
            || (group.editingTitle && active?.outMostBlock === group.title));
        if (!group)
            return;
        if (title ? !['F2', 'ArrowDown'].includes(event.key) : !['Enter', 'Escape'].includes(event.key))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'F2') {
            this.editTitle(group.title);
        }
        else if (event.key === 'Escape') {
            group.editingTitle = false;
            this._muya.editor.activeContentBlock = null;
            this._muya.editor.selection.clear();
            this._applyVisibility();
            group.toggle.focus({ preventScroll: true });
        }
        else {
            this._enterBody(group);
        }
    }

    dispose(): void {
        for (const group of this._groups.values())
            group.header.remove();
        for (const block of this._hidden)
            block.domNode?.classList.remove(HIDDEN);
        for (const block of this._source)
            block.domNode?.classList.remove(SOURCE);
        this._groups.clear();
        this._hidden.clear();
        this._hiddenBody.clear();
        this._source.clear();
    }
}
