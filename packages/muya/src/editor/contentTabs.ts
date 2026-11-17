import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type { Muya } from '../muya';
import type { TSelection } from '../selection/types';
import type { IContentTabBlock, IContentTabGroup } from '../utils/contentTabs';
import { isHiddenByFold } from '../block/folding';
import { ScrollPage } from '../block/scrollPage';
import { parseInline } from '../inline/parser/lexer';
import { tokensToPlainText } from '../inline/projection';
import { SelectionType } from '../selection/types';
import { contentTabHeading, contentTabsMarker, findContentTabGroups } from '../utils/contentTabs';

interface IGroupView {
    start: Parent;
    end: Parent;
    blocks: Parent[];
    headings: Parent[];
    active: Parent;
    expanded: boolean;
    editingTitle?: Parent;
    bar: HTMLDivElement;
    footer: HTMLDivElement;
    list: HTMLDivElement;
    addButton: HTMLButtonElement;
    sourceButton: HTMLButtonElement;
    buttons: Map<Parent, HTMLButtonElement>;
}

interface IMembership {
    group: IGroupView;
    heading?: Parent;
}

const CONTAINERS = new Set(['scrollpage', 'block-quote', 'github-alert', 'list-item', 'task-list-item', 'footnote']);
const HIDDEN_CLASS = 'mu-content-tabs-hidden';
const VIEW_CLASSES = [HIDDEN_CLASS, 'mu-content-tab-title', 'mu-content-tabs-boundary', 'mu-content-tabs-expanded'];

/** Tabs are a projection of ordinary Markdown blocks; switching them never creates an edit or undo entry. */
export class ContentTabs {
    private _groups = new Map<Parent, IGroupView>();
    private _memberships = new Map<TreeNode, IMembership[]>();
    private _decorated = new Set<TreeNode>();
    private _hidden = new Set<TreeNode>();
    private _buttonTargets = new WeakMap<Element, { group: IGroupView; action: 'tab' | 'add' | 'source'; heading?: Parent }>();

    constructor(private _muya: Muya) {
        const { eventCenter, domNode } = _muya;
        eventCenter.attachDOMEvent(domNode, 'click', event => this._click(event));
        eventCenter.attachDOMEvent(domNode, 'dblclick', event => this._editTitle(event));
        eventCenter.attachDOMEvent(domNode, 'keydown', event => this._keydown(event));
        eventCenter.on('selection-change', ({ selection }) => this._closeInactiveTitles(selection));
        eventCenter.attachDOMEvent(domNode, 'focusout', (event) => {
            const next = event instanceof FocusEvent ? event.relatedTarget : null;
            if (!(next instanceof Node) || !domNode.contains(next))
                this._closeInactiveTitles(null);
        });
    }

    refresh(): void {
        const root = this._muya.editor.scrollPage;
        if (!root)
            return;
        const retained = new Set<Parent>();
        this._memberships.clear();
        const visit = (parent: Parent) => {
            const children = parent.map(block => block).filter(block => block.isParent());
            if (CONTAINERS.has(parent.blockName)) {
                const descriptions = children.map(block => this._describe(block));
                for (const group of findContentTabGroups(descriptions)) {
                    const view = this._updateGroup(children, group);
                    retained.add(view.start);
                }
            }
            for (const child of children) {
                if (CONTAINERS.has(child.blockName) || /^(?:bullet|order|task)-list$/.test(child.blockName))
                    visit(child);
            }
        };
        visit(root);
        for (const [start, group] of this._groups) {
            if (!retained.has(start)) {
                group.bar.remove();
                group.footer.remove();
                this._groups.delete(start);
            }
        }
        this._applyVisibility();
        const editing = this._muya.editor.activeContentBlock;
        if (editing?.outMostBlock)
            this.reveal(editing);
    }

    private _describe(block: Parent): IContentTabBlock {
        if (block.blockName !== 'html-block' && block.blockName !== 'atx-heading')
            return {};
        const text = block.firstContentInDescendant()?.text ?? '';
        return block.blockName === 'html-block'
            ? { marker: contentTabsMarker(text) }
            : { heading: contentTabHeading(text) };
    }

    private _createGroup(start: Parent, end: Parent, headings: Parent[]): IGroupView {
        const bar = document.createElement('div');
        bar.className = 'mu-content-tabs-bar';
        bar.contentEditable = 'false';
        const footer = document.createElement('div');
        footer.className = 'mu-content-tabs-end';
        footer.contentEditable = 'false';
        const list = document.createElement('div');
        list.className = 'mu-content-tabs-list';
        list.setAttribute('role', 'tablist');
        list.setAttribute('aria-label', this._muya.i18n.t('Content tabs'));
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'mu-content-tabs-add';
        addButton.textContent = '+';
        addButton.title = this._muya.i18n.t('Add tab');
        addButton.setAttribute('aria-label', addButton.title);
        const sourceButton = document.createElement('button');
        sourceButton.type = 'button';
        sourceButton.className = 'mu-content-tabs-source';
        sourceButton.textContent = '</>';
        sourceButton.title = this._muya.i18n.t('Edit tabs source');
        sourceButton.setAttribute('aria-label', sourceButton.title);
        bar.append(list, addButton, sourceButton);
        const group: IGroupView = { start, end, blocks: [], headings, active: headings[0], expanded: false, bar, footer, list, addButton, sourceButton, buttons: new Map() };
        this._buttonTargets.set(addButton, { group, action: 'add' });
        this._buttonTargets.set(sourceButton, { group, action: 'source' });
        this._groups.set(start, group);
        return group;
    }

    private _updateGroup(blocks: Parent[], descriptor: IContentTabGroup): IGroupView {
        const start = blocks[descriptor.start];
        const headings = descriptor.headings.map(index => blocks[index]);
        const end = blocks[descriptor.end];
        const group = this._groups.get(start) ?? this._createGroup(start, end, headings);
        group.end = end;
        group.blocks = blocks.slice(descriptor.start, descriptor.end + 1);
        group.headings = headings;
        if (!headings.includes(group.active))
            group.active = headings[0];
        if (group.editingTitle && !headings.includes(group.editingTitle))
            group.editingTitle = undefined;
        start.domNode!.before(group.bar);
        end.domNode!.before(group.footer);
        for (const [heading, button] of group.buttons) {
            if (!headings.includes(heading)) {
                button.remove();
                group.buttons.delete(heading);
            }
        }
        for (const heading of headings) {
            let button = group.buttons.get(heading);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'mu-content-tab';
                button.setAttribute('role', 'tab');
                group.buttons.set(heading, button);
                this._buttonTargets.set(button, { group, heading, action: 'tab' });
            }
            const label = contentTabHeading(heading.firstContentInDescendant()!.text)!.label;
            const labels = this._muya.editor.inlineEngine.collectReferenceDefinitions();
            button.textContent = tokensToPlainText(parseInline(label, { options: this._muya.options, labels })) || this._muya.i18n.t('Untitled tab');
            button.title = this._muya.i18n.t('Double-click to edit tab title');
            group.list.append(button);
        }
        let heading: Parent | undefined;
        for (const block of group.blocks) {
            if (headings.includes(block))
                heading = block;
            const membership = { group, heading: block === end ? undefined : heading };
            const memberships = this._memberships.get(block) ?? [];
            memberships.push(membership);
            this._memberships.set(block, memberships);
        }
        return group;
    }

    private _applyVisibility(): void {
        for (const block of this._decorated)
            block.domNode?.classList.remove(...VIEW_CLASSES);
        this._decorated.clear();
        this._hidden.clear();
        for (const group of this._groups.values()) {
            this._decorateGroup(group);
            for (const [heading, button] of group.buttons) {
                const active = heading === group.active;
                button.setAttribute('aria-selected', String(active));
                button.tabIndex = active ? 0 : -1;
            }
            group.sourceButton.setAttribute('aria-pressed', String(group.expanded));
        }
        for (const block of this._hidden)
            block.domNode?.classList.add(HIDDEN_CLASS);
        this.refreshBarVisibility();
    }

    private _decorateGroup(group: IGroupView): void {
        for (const block of group.blocks) {
            const heading = this._memberships.get(block)?.find(item => item.group === group)?.heading;
            const boundary = block === group.start || block === group.end;
            const hidden = !group.expanded && (boundary
                || (heading !== undefined && heading !== group.active)
                || (block === heading && group.editingTitle !== heading));
            if (hidden)
                this._hidden.add(block);
            this._decorated.add(block);
            if (block === heading)
                block.domNode?.classList.add('mu-content-tab-title');
            if (boundary) {
                block.domNode?.classList.add('mu-content-tabs-boundary');
                block.domNode?.classList.toggle('mu-content-tabs-expanded', group.expanded);
            }
        }
    }

    refreshBarVisibility(): void {
        for (const group of this._groups.values()) {
            group.bar.hidden = isHiddenByFold(group.start) || (this._memberships.get(group.start) ?? []).some(({ group: outer, heading }) =>
                outer !== group && !outer.expanded && heading !== undefined && heading !== outer.active,
            );
            group.footer.hidden = group.bar.hidden;
        }
    }

    isHidden(block: TreeNode): boolean {
        for (let target: TreeNode | null = block; target && !target.isScrollPage; target = target.parent ?? null) {
            if (this._hidden.has(target))
                return true;
        }
        return false;
    }

    private _containing(block: TreeNode): IMembership[] {
        const memberships: IMembership[] = [];
        for (let target: TreeNode | null = block; target && !target.isScrollPage; target = target.parent ?? null)
            memberships.push(...(this._memberships.get(target) ?? []));
        return memberships;
    }

    reveal(block: TreeNode): void {
        if (!this.isHidden(block))
            return;
        for (const { group, heading } of this._containing(block)) {
            if (heading) {
                group.active = heading;
                if (heading === block || heading === block.parent)
                    group.editingTitle = heading;
            }
            else {
                group.expanded = true;
            }
        }
        this._applyVisibility();
    }

    revealSelection(anchor: TreeNode, focus: TreeNode): void {
        if (anchor === focus)
            return;
        const first = anchor.domNode;
        const last = focus.domNode;
        if (!first || !last)
            return;
        const before = (a: Node, b: Node) => a === b || Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const [start, end] = before(first, last) ? [first, last] : [last, first];
        const a = this._containing(anchor);
        const b = this._containing(focus);
        for (const group of this._groups.values()) {
            const firstTab = a.find(item => item.group === group)?.heading;
            const lastTab = b.find(item => item.group === group)?.heading;
            if (firstTab && firstTab === lastTab)
                continue;
            if (before(start, group.end.domNode!) && before(group.start.domNode!, end))
                group.expanded = true;
        }
        this._applyVisibility();
    }

    headingSource(block: Parent, text: string): string {
        return this._memberships.get(block)?.some(item => item.heading === block)
            ? contentTabHeading(text)?.source ?? text
            : text;
    }

    deletionTarget(block: Content, event: Event): Content | undefined {
        if (!this._groups.size || !(event instanceof KeyboardEvent) || !['Backspace', 'Delete'].includes(event.key))
            return;
        const cursor = block.getCursor();
        if (!cursor || cursor.start.offset !== cursor.end.offset)
            return;
        const backward = event.key === 'Backspace';
        if (cursor.start.offset !== (backward ? 0 : block.text.length))
            return;
        const target = backward ? block.previousContentInContext() : block.nextContentInContext();
        return target && this.isHidden(target) ? target : undefined;
    }

    revealDeletionTarget(target: Content, event: KeyboardEvent): void {
        // A single destructive key must not merge an unseen tab title or boundary into the current panel.
        event.preventDefault();
        event.stopPropagation();
        const offset = event.key === 'Backspace' ? target.text.length : contentTabHeading(target.text)?.prefixLength ?? 0;
        target.setCursor(offset, offset, true);
    }

    private _target(event: Event) {
        return event.target instanceof Element
            ? this._buttonTargets.get(event.target.closest('button')!)
            : undefined;
    }

    private _closeInactiveTitles(selection: TSelection | null): void {
        const endpoints = selection?.kind === SelectionType.TEXT
            ? [selection.context.anchorBlock.parent, selection.context.focusBlock.parent]
            : [];
        let changed = false;
        for (const group of this._groups.values()) {
            if (group.editingTitle && !endpoints.includes(group.editingTitle)) {
                group.editingTitle = undefined;
                changed = true;
            }
        }
        if (changed)
            this._applyVisibility();
    }

    private _addTab(group: IGroupView): void {
        if (!this._muya.canMutate)
            return;
        this._muya.flush();
        const parent = group.end.parent;
        if (!parent || this._groups.get(group.start) !== group)
            return;
        const last = group.headings.at(-1)!.getState();
        if (last.name !== 'atx-heading')
            return;
        const labels = new Set([...group.buttons.values()].map(button => button.textContent));
        const title = this._muya.i18n.t('Tab');
        let number = group.headings.length + 1;
        while (labels.has(`${title} ${number}`))
            number++;
        const heading = ScrollPage.loadBlock('atx-heading').create(this._muya, {
            name: 'atx-heading',
            meta: { level: last.meta.level },
            text: `${'#'.repeat(last.meta.level)} | ${title} ${number}`,
        }) as Parent;
        this._muya.transact(() => {
            parent.insertBefore(heading, group.end);
            parent.insertBefore(ScrollPage.loadBlock('paragraph').create(this._muya, { name: 'paragraph', text: '' }), group.end);
        });
        this._activate(group, heading);
        this._focusTitle(heading, true);
    }

    private _activate(group: IGroupView, heading: Parent): void {
        this._muya.flush();
        group.active = heading;
        group.expanded = false;
        group.editingTitle = undefined;
        this._muya.editor.activeContentBlock = null;
        this._muya.editor.selection.clear();
        this._applyVisibility();
        group.buttons.get(heading)?.focus({ preventScroll: true });
    }

    private _click(event: Event): void {
        const target = this._target(event);
        if (!target)
            return;
        event.stopPropagation();
        if (target.heading) {
            this._activate(target.group, target.heading);
        }
        else if (target.action === 'add') {
            this._addTab(target.group);
        }
        else {
            this._muya.flush();
            target.group.expanded = !target.group.expanded;
            this._muya.editor.selection.clear();
            this._applyVisibility();
        }
    }

    private _editTitle(event: Event): void {
        const target = this._target(event);
        if (!target?.heading || this._muya.isReadOnly)
            return;
        event.stopPropagation();
        this._focusTitle(target.heading);
    }

    private _focusTitle(heading: Parent, selectTitle = false): void {
        const content = heading.firstContentInDescendant()!;
        const start = contentTabHeading(content.text)!.prefixLength;
        content.setCursor(start, selectTitle ? content.text.length : start, true);
    }

    private _titleCompletionGroup(event: KeyboardEvent): IGroupView | undefined {
        if (this._muya.isReadOnly || event.isComposing || this._muya.editor.isComposing
            || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
            || !['Enter', 'Escape'].includes(event.key)) {
            return;
        }
        if (event.target instanceof Element && event.target.closest('button, input, select, textarea'))
            return;
        const selection = this._muya.editor.selection.getTextSelection();
        if (!selection?.isSelectionInSameBlock)
            return;
        return [...this._groups.values()].find(group => !group.expanded && group.editingTitle === selection.anchor.block.parent);
    }

    private _finishTitle(group: IGroupView, event: KeyboardEvent): void {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._muya.flush();
        const heading = group.editingTitle!;
        if (event.key === 'Escape') {
            this._activate(group, heading);
            return;
        }
        const next = heading.firstContentInDescendant()!.nextContentInContext(true);
        let body = next && this._containing(next).some(item => item.group === group && item.heading === heading) ? next : undefined;
        if (!body) {
            const paragraph = ScrollPage.loadBlock('paragraph').create(this._muya, { name: 'paragraph', text: '' }) as Parent;
            this._muya.transact(() => heading.parent!.insertAfter(paragraph, heading));
            body = paragraph.firstContentInDescendant()!;
        }
        body.setCursor(0, 0, true);
    }

    private _keydown(event: Event): void {
        if (!(event instanceof KeyboardEvent) || event.defaultPrevented)
            return;
        const completing = this._titleCompletionGroup(event);
        if (completing) {
            this._finishTitle(completing, event);
            return;
        }
        if (this._isSelectAll(event)) {
            // Native select-all can anchor on the noneditable tab bar instead of a document block.
            event.preventDefault();
            event.stopPropagation();
            this._muya.selectAll();
            return;
        }
        const target = this._target(event);
        if (!target?.heading)
            return;
        const { group, heading } = target;
        const index = group.headings.indexOf(heading);
        const keys: Record<string, number> = { ArrowLeft: (index + group.headings.length - 1) % group.headings.length, ArrowRight: (index + 1) % group.headings.length, Home: 0, End: group.headings.length - 1 };
        if (event.key in keys) {
            event.preventDefault();
            event.stopPropagation();
            this._activate(group, group.headings[keys[event.key]]);
        }
        else if ((event.key === 'F2' || event.key === 'ArrowDown') && !this._muya.isReadOnly) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'F2') {
                this._focusTitle(heading);
            }
            else {
                const body = heading.firstContentInDescendant()!.nextContentInContext(true);
                if (body && this._containing(body).some(item => item.group === group && item.heading === heading))
                    body.setCursor(0, 0, true);
                else
                    this._focusTitle(heading);
            }
        }
    }

    private _isSelectAll(event: KeyboardEvent): boolean {
        return this._groups.size > 0 && !event.defaultPrevented
            && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
            && event.key.toLowerCase() === 'a' && !this._muya.isReadOnly;
    }

    dispose(): void {
        for (const group of this._groups.values()) {
            group.bar.remove();
            group.footer.remove();
        }
        for (const block of this._decorated)
            block.domNode?.classList.remove(...VIEW_CLASSES);
        this._groups.clear();
        this._memberships.clear();
        this._decorated.clear();
        this._hidden.clear();
    }
}
