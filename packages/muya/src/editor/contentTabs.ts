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
import { getCursorCoords } from '../selection/cursorCoords';
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

interface IBodyCaret {
    block: Content;
    offset: number;
}

interface ITitleEditor {
    group: IGroupView;
    heading: Parent;
    button: HTMLButtonElement;
    input: HTMLInputElement;
    prefix: string;
    suffix: string;
    source: string;
    returnCaret?: IBodyCaret;
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
    private _titleEditor?: ITitleEditor;
    private _buttonTargets = new WeakMap<Element, { group: IGroupView; action: 'tab' | 'add' | 'source'; heading?: Parent }>();

    constructor(private _muya: Muya) {
        const { eventCenter, domNode } = _muya;
        eventCenter.attachDOMEvent(domNode, 'click', event => this._click(event));
        eventCenter.attachDOMEvent(domNode, 'dblclick', event => this._editTitle(event));
        eventCenter.attachDOMEvent(domNode, 'keydown', event => this._keydown(event));
        eventCenter.on('selection-change', ({ selection }) => this._closeInactiveTitles(selection));
        eventCenter.on('read-only-changed', () => this._closeTitleInput());
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
        // Re-inserting a connected control blurs its input, even at the same position.
        if (start.domNode!.previousElementSibling !== group.bar)
            start.domNode!.before(group.bar);
        if (end.domNode!.previousElementSibling !== group.footer)
            end.domNode!.before(group.footer);
        for (const [heading, button] of group.buttons) {
            if (!headings.includes(heading)) {
                button.parentElement!.remove();
                group.buttons.delete(heading);
            }
        }
        for (const [index, heading] of headings.entries()) {
            let button = group.buttons.get(heading);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'mu-content-tab';
                button.setAttribute('role', 'tab');
                const slot = document.createElement('span');
                slot.append(button);
                group.buttons.set(heading, button);
                this._buttonTargets.set(button, { group, heading, action: 'tab' });
            }
            const text = heading.firstContentInDescendant()!.text;
            const { label, prefixLength } = contentTabHeading(text)!;
            const editor = this._titleEditor;
            if (editor?.heading === heading && text !== editor.source) {
                // Undo and external edits can update the heading while the native input retains focus.
                editor.prefix = text.slice(0, prefixLength);
                editor.suffix = text.slice(prefixLength + label.length);
                editor.input.value = label;
                editor.source = text;
            }
            const labels = this._muya.editor.inlineEngine.collectReferenceDefinitions();
            button.textContent = tokensToPlainText(parseInline(label, { options: this._muya.options, labels })) || this._muya.i18n.t('Untitled tab');
            button.title = this._muya.i18n.t('Double-click to edit tab title');
            const slot = button.parentElement!;
            const current = group.list.children.item(index);
            if (current !== slot)
                group.list.insertBefore(slot, current);
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
        const editor = this._titleEditor;
        if (editor && (!editor.input.isConnected || editor.group.bar.hidden || editor.group.expanded || editor.group.active !== editor.heading))
            this._closeTitleInput();
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
        if (selection && this._titleEditor)
            this._closeTitleInput();
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
        this.editTitle(heading);
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
        this.editTitle(target.heading);
    }

    private _panelBody(group: IGroupView, heading: Parent): Content | undefined {
        const next = heading.firstContentInDescendant()!.nextContentInContext(true);
        return next && this._containing(next).some(item => item.group === group && item.heading === heading) ? next : undefined;
    }

    focusTabFor(block: Content): void {
        const panel = this._containing(block).find(({ group }) => !group.bar.hidden);
        if (panel)
            panel.group.buttons.get(panel.group.active)?.focus();
    }

    titleAbove(block: Content, event: KeyboardEvent): Parent | undefined {
        if (event.key !== 'ArrowUp' || !this._groups.size || this._muya.isReadOnly || event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
            return;
        const cursor = block.getCursor();
        if (!cursor?.isCollapsed)
            return;
        for (let ancestor = block.parent; ancestor && !ancestor.isScrollPage; ancestor = ancestor.parent) {
            // Same-container memberships are recorded outermost first. The closest tab bar owns Up.
            const memberships = this._memberships.get(ancestor);
            const panel = memberships?.slice().reverse().find(({ group, heading }) => {
                if (group.expanded || group.bar.hidden || heading !== group.active || ancestor === heading)
                    return false;
                const first = this._panelBody(group, heading);
                return this._isFirstBodyLineBlock(block, first);
            });
            if (panel)
                return panel.heading;
        }
    }

    private _isFirstBodyLineBlock(block: Content, first?: Content): boolean {
        return first === block || (first?.blockName === 'table.cell.content' && block.blockName === 'table.cell.content'
            && first.parent?.parent === block.parent?.parent);
    }

    editTitle(heading: Parent, returnCaret?: IBodyCaret): void {
        if (this._muya.isReadOnly)
            return;
        if (!this._memberships.has(heading))
            this.refresh();
        const group = this._memberships.get(heading)?.find(item => item.heading === heading)?.group;
        if (!group)
            return;
        const x = returnCaret ? getCursorCoords()?.x : undefined;
        this._closeTitleInput();
        this._activate(group, heading);
        const button = group.buttons.get(heading)!;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mu-content-tab-input';
        input.setAttribute('aria-label', this._muya.i18n.t('Tab'));
        const content = heading.firstContentInDescendant()!;
        const { label, prefixLength } = contentTabHeading(content.text)!;
        const editor: ITitleEditor = {
            group,
            heading,
            button,
            input,
            returnCaret,
            source: content.text,
            prefix: content.text.slice(0, prefixLength),
            suffix: content.text.slice(prefixLength + label.length),
        };
        this._titleEditor = editor;
        input.value = label;
        button.hidden = true;
        button.after(input);
        input.addEventListener('blur', () => {
            if (this._titleEditor === editor)
                this._closeTitleInput();
        });
        input.addEventListener('keydown', event => this._titleInputKeydown(editor, event));
        for (const type of ['copy', 'cut', 'paste', 'beforeinput', 'keyup', 'compositionstart'])
            input.addEventListener(type, event => event.stopPropagation());
        const writeTitle = (event: Event) => {
            event.stopPropagation();
            if (this._titleEditor !== editor || !this._muya.canMutate || (event instanceof InputEvent && event.isComposing))
                return;
            editor.source = editor.prefix + input.value + editor.suffix;
            this._muya.editor.transact(() => {
                content.text = editor.source;
                content.update();
            });
        };
        input.addEventListener('input', writeTitle);
        input.addEventListener('compositionend', writeTitle);
        this._muya.editor.history.cutoff();
        input.focus();
        if (returnCaret) {
            const rect = input.getBoundingClientRect();
            const point = x === undefined
                ? null
                : document.caretPositionFromPoint?.(
                        Math.max(rect.left + 1, Math.min(rect.right - 1, x)),
                        rect.top + rect.height / 2,
                    );
            const offset = point?.offsetNode === input ? point.offset : returnCaret.offset;
            input.setSelectionRange(offset, offset);
        }
        else {
            input.select();
        }
    }

    private _closeTitleInput(): void {
        const editor = this._titleEditor;
        if (!editor)
            return;
        this._titleEditor = undefined;
        editor.button.hidden = false;
        editor.input.remove();
        this._muya.editor.history.cutoff();
    }

    private _titleInputKeydown(editor: ITitleEditor, event: KeyboardEvent): void {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229 || event.altKey)
            return;
        if (event.metaKey || event.ctrlKey) {
            const key = event.key.toLowerCase();
            if (key === 'z' || key === 'y') {
                event.preventDefault();
                if (key === 'y' || event.shiftKey)
                    this._muya.redo();
                else
                    this._muya.undo();
            }
            return;
        }
        if (event.shiftKey || !['Escape', 'Enter', 'ArrowDown'].includes(event.key))
            return;
        event.preventDefault();
        const { group, heading, returnCaret } = editor;
        this._closeTitleInput();
        if (event.key === 'Escape') {
            this._activate(group, heading);
            return;
        }
        const first = this._panelBody(group, heading);
        if (event.key === 'ArrowDown' && returnCaret && this._isFirstBodyLineBlock(returnCaret.block, first)) {
            returnCaret.block.setCursor(returnCaret.offset, returnCaret.offset, true);
            return;
        }
        this._enterBody(group, heading);
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
        this._enterBody(group, heading);
    }

    private _enterBody(group: IGroupView, heading: Parent): void {
        let body = this._panelBody(group, heading);
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
        if (!target || target.action === 'source' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
        const { group, heading } = target;
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this._navigateBar(group, heading, event.key);
            return;
        }
        if (this._muya.isReadOnly)
            return;
        if (!heading) {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopImmediatePropagation();
                this._addTab(group);
            }
            return;
        }
        if (!['Enter', 'F2', 'ArrowDown'].includes(event.key))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const body = event.key === 'ArrowDown' ? this._panelBody(group, heading) : undefined;
        if (body)
            body.setCursor(0, 0, true);
        else
            this.editTitle(heading);
    }

    private _navigateBar(group: IGroupView, heading: Parent | undefined, key: string): void {
        const { headings } = group;
        const count = headings.length + (this._muya.isReadOnly ? 0 : 1);
        const index = heading ? headings.indexOf(heading) : headings.length;
        const positions: Record<string, number> = {
            ArrowLeft: (index + count - 1) % count,
            ArrowRight: (index + 1) % count,
            Home: 0,
            End: headings.length - 1,
        };
        const next = positions[key];
        if (next === headings.length)
            group.addButton.focus();
        else
            this._activate(group, headings[next]);
    }

    private _isSelectAll(event: KeyboardEvent): boolean {
        return this._groups.size > 0 && !event.defaultPrevented
            && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
            && event.key.toLowerCase() === 'a' && !this._muya.isReadOnly;
    }

    dispose(): void {
        this._closeTitleInput();
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
