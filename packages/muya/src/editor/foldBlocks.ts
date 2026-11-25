import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type { ITokenRange } from '../inline/model/types';
import type { Muya } from '../muya';
import type { TSelection } from '../selection/types';
import { isHiddenByFold } from '../block/folding';
import { ScrollPage } from '../block/scrollPage';
import { parseInline } from '../inline/parser/lexer';
import { tokensToPlainText } from '../inline/projection';
import { offsetInBlockAtPoint } from '../selection/dom';
import { SelectionType } from '../selection/types';
import { atxHeadingBodyRange } from '../state/headings';
import { findFoldBlockGroups, foldBlockMarker, foldTitleStrong } from '../utils/foldBlocks';

interface IFoldTitle {
    label: string;
    boldRange?: ITokenRange;
}

interface IFoldView {
    start: Parent;
    title: Parent;
    boldTitleRange?: ITokenRange;
    end: Parent;
    body: Parent[];
    open: boolean;
    defaultOpen: boolean;
    editingTitle: boolean;
    showSource: boolean;
    header: HTMLDivElement;
    footer: HTMLDivElement;
    toggle: HTMLButtonElement;
    menu: HTMLDetailsElement;
    defaultButton: HTMLButtonElement;
}

const HIDDEN = 'mu-fold-block-hidden';
const SOURCE = 'mu-fold-block-source';
const DEPTH = '--mu-fold-block-depth';
const SURFACE_HEIGHT = '--mu-fold-block-surface-height';
const BODY = 'mu-fold-block-body';

function before(a: Node, b: Node): boolean {
    return a === b || Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** A disclosure view over ordinary Markdown blocks. Its initial state comes from the opening comment. */
export class FoldBlocks {
    private _groups = new Map<Parent, IFoldView>();
    private _hidden = new Set<TreeNode>();
    private _hiddenBody = new Set<TreeNode>();
    private _source = new Set<TreeNode>();
    private _indented = new Set<HTMLElement>();
    private readonly _resizeObserver?: ResizeObserver;
    private _layoutFrame: number | null = null;

    constructor(private _muya: Muya) {
        const { domNode, eventCenter } = _muya;
        if (typeof ResizeObserver !== 'undefined')
            this._resizeObserver = new ResizeObserver(() => this._scheduleLayout());
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
        }));
        const titles = new Map<number, IFoldTitle>();
        const groups = findFoldBlockGroups(descriptors, (index) => {
            const title = this._describeTitle(blocks[index]);
            if (!title)
                return false;
            titles.set(index, title);
            return true;
        });
        if (!groups.length && !this._groups.size)
            return;
        const valid = new Set<Parent>();
        for (const { start, title, end, defaultOpen } of groups) {
            const opener = blocks[start];
            const titleBlock = blocks[title];
            const { label, boldRange } = titles.get(title)!;
            const group = this._groups.get(opener) ?? this._create(opener, titleBlock, blocks[end], defaultOpen);
            group.editingTitle = group.editingTitle && titleBlock === group.title;
            group.title = titleBlock;
            group.boldTitleRange = boldRange;
            group.end = blocks[end];
            group.body = blocks.slice(title + 1, end);
            group.defaultOpen = defaultOpen;
            valid.add(opener);

            if (group.toggle.textContent !== label)
                group.toggle.textContent = label;
            if (opener.domNode!.previousElementSibling !== group.header)
                opener.domNode!.before(group.header);
            if (group.end.domNode!.previousElementSibling !== group.footer)
                group.end.domNode!.before(group.footer);
        }

        for (const [opener, group] of this._groups) {
            if (!valid.has(opener)) {
                this._resizeObserver?.unobserve(group.header);
                group.header.remove();
                group.footer.remove();
                this._groups.delete(opener);
            }
        }
        root.domNode!.classList.toggle('mu-has-fold-blocks', this.hasGroups);
        this._applyVisibility();
    }

    private _describeTitle(block: Parent): IFoldTitle | undefined {
        const profile = block.blockName;
        if (profile !== 'atx-heading' && profile !== 'setext-heading' && profile !== 'paragraph')
            return;
        const text = block.firstContentInDescendant()?.text ?? '';
        const labels = this._muya.editor.inlineEngine.collectReferenceDefinitions();
        const tokens = parseInline(text, { profile, labels, options: this._muya.options });
        let boldRange: ITokenRange | undefined;
        if (profile === 'paragraph') {
            const strong = foldTitleStrong(tokens, token => token.type === 'em' ? token.children : undefined);
            if (strong?.type !== 'strong')
                return;
            boldRange = { start: strong.range.start + strong.marker.length, end: strong.range.end - strong.marker.length };
        }
        return { label: tokensToPlainText(tokens).trim() || this._muya.i18n.t('Fold block'), boldRange };
    }

    private _create(start: Parent, title: Parent, end: Parent, defaultOpen: boolean): IFoldView {
        const document = start.domNode!.ownerDocument;
        const { i18n } = this._muya;
        const header = document.createElement('div');
        header.className = 'mu-fold-block-header';
        header.contentEditable = 'false';
        const footer = document.createElement('div');
        footer.className = 'mu-fold-block-footer';
        footer.contentEditable = 'false';
        footer.setAttribute('aria-hidden', 'true');
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
            footer,
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
        this._resizeObserver?.observe(header);
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
        if (!this.hasGroups && !this._indented.size)
            return;
        const depths = new Map<Parent, number>();
        for (const group of this._groups.values()) {
            const hasBody = group.open && group.body.length > 0;
            group.header.hidden = group.editingTitle || group.showSource || this._hiddenBody.has(group.start)
                || isHiddenByFold(group.start) || this._muya.editor.contentTabs.isHidden(group.start);
            group.header.classList.toggle('mu-fold-block-open', hasBody);
            group.footer.hidden = group.header.hidden || !hasBody;
            if (group.header.hidden) {
                group.menu.open = false;
            }
            else if (hasBody) {
                for (const block of group.body)
                    depths.set(block, (depths.get(block) ?? 0) + 1);
            }
        }
        this._updateInsets(depths);
        for (const group of this._groups.values())
            group.header.style.setProperty(DEPTH, String(Math.min(depths.get(group.start) ?? 0, 3)));
        this._scheduleLayout();
    }

    private _updateInsets(depths: Map<Parent, number>): void {
        const indented = new Set<HTMLElement>();
        for (const [block, depth] of depths) {
            const element = block.domNode!;
            element.classList.add(BODY);
            element.style.setProperty(DEPTH, String(Math.min(depth, 3)));
            indented.add(element);
            if (!this._indented.has(element))
                this._resizeObserver?.observe(element);
        }
        for (const element of this._indented) {
            if (indented.has(element))
                continue;
            element.classList.remove(BODY);
            element.style.removeProperty(DEPTH);
            this._resizeObserver?.unobserve(element);
        }
        this._indented = indented;
    }

    private _scheduleLayout(): void {
        if (!this.hasGroups || this._layoutFrame !== null)
            return;
        this._layoutFrame = requestAnimationFrame(() => {
            this._layoutFrame = null;
            // Measure siblings in place so the editable DOM follows the document tree.
            const heights = [...this._groups.values()].map((group) => {
                const height = group.footer.hidden
                    ? ''
                    : `${group.footer.getBoundingClientRect().bottom - group.header.getBoundingClientRect().top}px`;
                return { group, height };
            });
            for (const { group, height } of heights)
                group.header.style.setProperty(SURFACE_HEIGHT, height);
        });
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

    private _canNavigateTitle(block: Content, event: KeyboardEvent): boolean {
        return this.hasGroups && this._muya.canMutate && !this._muya.editor.isComposing
            && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.isComposing
            && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
            && block.getCursor()?.isCollapsed === true;
    }

    titleAtArrowBoundary(block: Content, event: KeyboardEvent, tabBoundary?: Content): Parent | undefined {
        if (!this._canNavigateTitle(block, event))
            return;
        const up = event.key === 'ArrowUp';
        const next = (content: Content) => up ? content.previousContentInContext() : content.nextContentInContext();
        const row = block.blockName === 'table.cell.content' ? block.parent?.parent : undefined;
        const edge = row ? (up ? row.firstContentInDescendant() : row.lastContentInDescendant()) : block;
        // The disclosure is painted just before its opener in the block order.
        for (let candidate = edge && next(edge); candidate; candidate = next(candidate)) {
            if (candidate === tabBoundary)
                return;
            const outer = candidate.outMostBlock;
            const group = outer?.isParent() ? this._groups.get(outer) : undefined;
            if (group && !group.header.hidden)
                return group.title;
            if (!this.isHidden(candidate) && !isHiddenByFold(candidate) && !this._muya.editor.contentTabs.isHidden(candidate))
                return;
        }
    }

    editTitle(title: Parent, caret?: { edge: 'top' | 'bottom'; x?: number }): void {
        if (!this._muya.canMutate)
            return;
        let group = [...this._groups.values()].find(group => group.title === title);
        if (!group) {
            this.refresh();
            group = [...this._groups.values()].find(group => group.title === title);
        }
        const content = title.firstContentInDescendant();
        if (!group || !content)
            return;
        group.editingTitle = true;
        group.showSource = false;
        this._applyVisibility();
        const range = group.boldTitleRange ?? (title.blockName === 'atx-heading'
            ? atxHeadingBodyRange(content.text)
            : { start: 0, end: content.text.length });
        if (caret) {
            const nearest = caret.x == null ? null : offsetInBlockAtPoint(title.domNode!.ownerDocument, content, caret.x, caret.edge);
            const offset = nearest == null
                ? (caret.edge === 'top' ? range.start : range.end)
                : Math.max(range.start, Math.min(nearest, range.end));
            content.setCursor(offset, offset, true);
        }
        else {
            content.setCursor(range.start, range.end, true);
        }
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
        if (this._layoutFrame !== null)
            cancelAnimationFrame(this._layoutFrame);
        this._layoutFrame = null;
        this._resizeObserver?.disconnect();
        this._muya.editor.scrollPage?.domNode?.classList.remove('mu-has-fold-blocks');
        for (const group of this._groups.values()) {
            group.header.remove();
            group.footer.remove();
        }
        for (const block of this._hidden)
            block.domNode?.classList.remove(HIDDEN);
        for (const block of this._source)
            block.domNode?.classList.remove(SOURCE);
        this._updateInsets(new Map());
        this._groups.clear();
        this._hidden.clear();
        this._hiddenBody.clear();
        this._source.clear();
    }
}
