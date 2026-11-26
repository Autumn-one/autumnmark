import type Format from '../block/base/format';
import type Table from '../block/gfm/table';
import type TableBodyCell from '../block/gfm/table/cell';
import type { Muya } from '../muya';
import type { IImageInfo } from '../utils/image';
import type { IImageCaret } from './imageCaret';
import type {
    IImageSelection,
    IResolvedTextSelection,
    ISelectionEndpoints,
    ITableRectSelection,
    ITableRectSelectionState,
    ITextSelection,
    TSelection,
    TSelectionCoords,
    TSelectionState,
} from './types';
import { isHiddenByFold } from '../block/folding';
import { CLASS_NAMES } from '../config';
import { getImageInfo } from '../utils/image';
import { buildAffiliation, buildSelectionAffiliation, endpointBlockInfo } from './affiliation';
import { getCursorCoords, getCursorYOffset, getSelectionStart } from './cursorCoords';
import { getOffsetOfParagraph } from './dom';
import { clearImageCaret, imageCaret, paintImageCaret } from './imageCaret';
import ImageSelection from './ImageSelection';
import {
    comparePaths,
    contentPath,
    copySelectionState,
    createTextSelectionState,
    isLegalOffset,
    isSelectionState,
    resolveContent,
    resolveTextSelectionEndpoints,
} from './state';
import TableRectSelection from './TableRectSelection';
import TextSelection from './TextSelection';
import { SelectionDirection, SelectionType } from './types';

class Selection {
    static getCursorYOffset = getCursorYOffset;
    static getCursorCoords = getCursorCoords;
    static getSelectionStart = getSelectionStart;

    private _text: TextSelection;
    private _image: ImageSelection;
    private _table: TableRectSelection;
    private _state: TSelectionState | null = null;
    private _setting = false;
    private _frame: number | null = null;
    private _docChanged = false;
    private _preventScroll = false;
    private _lastPublished = '';
    private _imageCaret: (IImageCaret & { element: HTMLElement }) | null = null;
    private _hasLiveNativeSelection = false;
    private _pointerFocusing = false;
    private _pointerFocusTimer: ReturnType<typeof setTimeout> | null = null;
    private _suppressFocusScroll = false;
    private _suppressFocusScrollTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private _muya: Muya) {
        this._text = new TextSelection(_muya, this);
        this._image = new ImageSelection(_muya, this);
        this._image.attach();
        this._table = TableRectSelection.create(_muya);
        _muya.eventCenter.attachDOMEvent(document, 'selectionchange', () => this.syncTextSelection());
        _muya.eventCenter.attachDOMEvent(document, 'mouseup', () => this.flush());
        const markPointerFocus = () => {
            this._pointerFocusing = true;
            this._clearSuppressFocusScroll();
            if (this._pointerFocusTimer !== null)
                clearTimeout(this._pointerFocusTimer);
            // Reset after the same-task pointerdown -> mousedown -> focus sequence.
            this._pointerFocusTimer = setTimeout(() => {
                this._pointerFocusTimer = null;
                this._pointerFocusing = false;
            }, 0);
        };
        _muya.eventCenter.attachDOMEvent(_muya.domNode, 'pointerdown', markPointerFocus, true);
        _muya.eventCenter.attachDOMEvent(_muya.domNode, 'mousedown', markPointerFocus, true);
        _muya.eventCenter.attachDOMEvent(_muya.domNode, 'focus', event => this._handleRootFocus(event));
    }

    get type(): SelectionType | null {
        return this._state?.kind ?? null;
    }

    get table(): TableRectSelection {
        return this._table;
    }

    get image() {
        return this.getImageSelection()?.context ?? null;
    }

    get anchorBlock() {
        return this._text.anchorBlock;
    }

    get focusBlock() {
        return this._text.focusBlock;
    }

    get anchorPath() {
        return this._text.anchorPath;
    }

    get focusPath() {
        return this._text.focusPath;
    }

    get anchor() {
        return this._text.anchor;
    }

    get focus() {
        return this._text.focus;
    }

    get isSelectionInSameBlock() {
        return this._text.isSelectionInSameBlock;
    }

    private _isExternalInputFocused(): boolean {
        const focused = this._muya.domNode.ownerDocument.activeElement;
        const inputFocused = focused?.tagName === 'INPUT' || focused?.tagName === 'TEXTAREA';
        return !this._muya.isReadOnly && inputFocused && !this._muya.domNode.contains(focused);
    }

    private _readLiveNativeInDocument(): IResolvedTextSelection | null {
        const live = this._text.getSelection();
        if (!live)
            return null;
        const { anchor, focus } = live;
        return this._muya.isBlockInDocument(anchor.block) && this._muya.isBlockInDocument(focus.block)
            ? live
            : null;
    }

    private _readNative(): IResolvedTextSelection | null {
        // Switching external inputs can collapse the DOM range without moving the editor selection.
        if (this._isExternalInputFocused())
            return null;
        return this._readLiveNativeInDocument();
    }

    /** Record that the native DOM selection was explicitly cleared before an async selectionchange arrives. */
    markNativeSelectionCleared(): void {
        this._hasLiveNativeSelection = false;
    }

    /** Re-sync whether a live native text range currently exists inside the document. */
    refreshNativeSelectionPresence(): void {
        this._hasLiveNativeSelection = this._readLiveNativeInDocument() !== null;
    }

    private _armSuppressFocusScroll(): void {
        this._clearSuppressFocusScroll();
        this._suppressFocusScroll = true;
        // Expire after Blink's already-queued focus selectionchange task runs.
        this._suppressFocusScrollTimer = setTimeout(() => {
            this._suppressFocusScrollTimer = null;
            this._suppressFocusScroll = false;
        }, 0);
    }

    private _clearSuppressFocusScroll(): void {
        this._suppressFocusScroll = false;
        if (this._suppressFocusScrollTimer !== null) {
            clearTimeout(this._suppressFocusScrollTimer);
            this._suppressFocusScrollTimer = null;
        }
    }

    private _resolveRestorableTextOnRootFocus(
        state: Extract<TSelectionState, { kind: SelectionType.TEXT }>,
    ): ISelectionEndpoints | null {
        const endpoints = resolveTextSelectionEndpoints(this._muya, state);
        if (!endpoints)
            return null;
        const { anchor, focus } = endpoints;
        const { contentTabs, foldBlocks } = this._muya.editor;
        const visible = Boolean(anchor.block.domNode?.isConnected && focus.block.domNode?.isConnected)
            && !anchor.block.isInert
            && !focus.block.isInert
            && !isHiddenByFold(anchor.block)
            && !isHiddenByFold(focus.block)
            && !contentTabs.isHidden(anchor.block)
            && !contentTabs.isHidden(focus.block)
            && !foldBlocks.isHidden(anchor.block)
            && !foldBlocks.isHidden(focus.block);
        return visible ? endpoints : null;
    }

    private _restoreCachedTextOnRootFocus(
        state: Extract<TSelectionState, { kind: SelectionType.TEXT }>,
        endpoints: ISelectionEndpoints,
    ): void {
        const priorState = copySelectionState(this._state);
        let written = false;
        this._setting = true;
        try {
            const { anchor, focus } = endpoints;
            this._state = copySelectionState(state);
            this._image.clear();
            this._table.clear();
            this._muya.editor.activeContentBlock = anchor.block === focus.block ? anchor.block : null;
            this._text.setSelection(anchor, focus, { syncDom: true });
            const live = this._readLiveNativeInDocument();
            written = live !== null
                && live.anchor.block === anchor.block
                && live.focus.block === focus.block;
            if (!written)
                this._state = priorState;
            this._hasLiveNativeSelection = written;
        }
        finally {
            this._setting = false;
        }

        if (written && this._canNotify) {
            this._preventScroll = true;
            this.notify();
        }
        this._armSuppressFocusScroll();
    }

    private _consumePointerFocus(): boolean {
        const fromPointer = this._pointerFocusing;
        this._pointerFocusing = false;
        if (this._pointerFocusTimer !== null) {
            clearTimeout(this._pointerFocusTimer);
            this._pointerFocusTimer = null;
        }
        return fromPointer;
    }

    private _isNonTextSelectionActive(): boolean {
        return this._table.hasSelection
            || this._state?.kind === SelectionType.IMAGE
            || this._state?.kind === SelectionType.TABLE;
    }

    private _clearNativeSelectionInsideRoot(): void {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0 && sel.anchorNode && this._muya.domNode.contains(sel.anchorNode))
            sel.removeAllRanges();
    }

    private _handleRootFocus(event: Event): void {
        if (event.target !== this._muya.domNode)
            return;
        const fromPointer = this._consumePointerFocus();
        if (fromPointer || this._hasLiveNativeSelection || this._muya.isReadOnly || this._setting || this._muya.editor.isUpdating)
            return;

        // Blink synthesizes a collapsed caret at block 0 when a contenteditable root
        // receives non-pointer focus with an empty native selection; restore our last
        // valid caret without scrolling instead of letting selectionchange jump to top.
        if (this._isNonTextSelectionActive()) {
            this._clearNativeSelectionInsideRoot();
            this._hasLiveNativeSelection = false;
            this._armSuppressFocusScroll();
            return;
        }
        if (this._state?.kind === SelectionType.TEXT) {
            const endpoints = this._resolveRestorableTextOnRootFocus(this._state);
            if (endpoints) {
                this._restoreCachedTextOnRootFocus(this._state, endpoints);
                return;
            }
        }

        this._armSuppressFocusScroll();
    }

    private _cacheText(live: IResolvedTextSelection) {
        const { anchor, focus } = live;
        // Native reads refresh the public state; block handlers still need the
        // previously applied endpoints when updating inline presentation.
        this._state = createTextSelectionState(anchor, focus);
        if (this._text.anchor && this._text.focus)
            return;

        this._text.anchor = {
            offset: anchor.offset,
        };
        this._text.focus = {
            offset: focus.offset,
        };
        this._text.anchorBlock = anchor.block;
        this._text.focusBlock = focus.block;
        this._text.anchorPath = [...anchor.path];
        this._text.focusPath = [...focus.path];
    }

    getSelectionState(): TSelectionState | null {
        if (!this._setting && (!this._state || this._state.kind === SelectionType.TEXT)) {
            const live = this._readNative();
            if (live)
                this._cacheText(live);
        }
        return copySelectionState(this._state);
    }

    getSelection(): TSelection | null {
        const state = this.getSelectionState();
        return state ? this._resolve(state) : null;
    }

    getTextSelection(): IResolvedTextSelection | null {
        const state = this.getSelectionState();
        const selection = state?.kind === SelectionType.TEXT ? this._resolveText(state, { includeFormats: false, validateOffsets: false }) : null;
        if (!selection)
            return null;
        const { anchor, focus, context } = selection;
        const { anchorBlock, focusBlock, isCollapsed, isSelectionInSameBlock, direction } = context;
        return {
            anchor: {
                ...anchor,
                path: [...anchor.path],
                block: anchorBlock,
            },
            focus: {
                ...focus,
                path: [...focus.path],
                block: focusBlock,
            },
            isCollapsed,
            isSelectionInSameBlock,
            direction,
        };
    }

    getImageSelection(): IImageSelection | null {
        if (this._state?.kind !== SelectionType.IMAGE)
            return null;
        const state = copySelectionState(this._state) as Extract<TSelectionState, { kind: SelectionType.IMAGE }>;
        return this._resolveImage(state);
    }

    setSelection(state: TSelectionState | null, { preventScroll = false, preserveFocus = false } = {}): boolean {
        if (state !== null && !isSelectionState(state))
            return false;
        const selection = state ? this._resolve(state) : null;
        if (state && !selection)
            return false;
        this._clearSuppressFocusScroll();
        this._preventScroll = preventScroll;
        this._setting = true;
        try {
            this._state = copySelectionState(state);
            this._image.clear();
            this._table.clear();
            if (selection?.kind !== SelectionType.TEXT) {
                this._muya.editor.activeContentBlock = null;
                this._text.collapse();
            }
            if (selection?.kind === SelectionType.TEXT) {
                const { anchor, focus } = selection;
                const { anchorBlock, focusBlock } = selection.context;
                this._muya.editor.activeContentBlock = anchorBlock === focusBlock ? anchorBlock : null;
                this._text.setSelection(
                    {
                        ...anchor,
                        path: [...anchor.path],
                        block: anchorBlock,
                    },
                    {
                        ...focus,
                        path: [...focus.path],
                        block: focusBlock,
                    },
                    { syncDom: !preserveFocus },
                );
            }
            else {
                if (selection?.kind === SelectionType.IMAGE)
                    this._image.setSelection(this._resolveImage(selection) ?? selection);
                else if (selection?.kind === SelectionType.TABLE)
                    this._table.setSelection(selection, { preserveFocus });
            }
            this._syncLiveNativePresence(selection);
        }
        finally {
            this._setting = false;
        }
        this.notify();
        return true;
    }

    private _syncLiveNativePresence(selection: TSelection | null): void {
        this._hasLiveNativeSelection = selection?.kind === SelectionType.TEXT
            && this._readLiveNativeInDocument() !== null;
    }

    clear() {
        this.setSelection(null);
    }

    clearImage() {
        if (this.type === SelectionType.IMAGE)
            this.clear();
    }

    selectImage(data: IImageInfo & { block: Format }): void {
        const { block, token } = data;
        const { range, raw } = token;
        // Re-clicking a selected image must reopen tools hidden by scrolling.
        this._lastPublished = '';
        this.setSelection({
            kind: SelectionType.IMAGE,
            path: contentPath(block),
            range,
            raw,
        });
    }

    syncTextSelection() {
        // Root focus can plant a caret while the table owns the visible selection.
        if (this._setting)
            return;
        if (this._table.hasSelection || this.type === SelectionType.IMAGE) {
            this._hasLiveNativeSelection = false;
            return;
        }
        const liveInDoc = this._readLiveNativeInDocument();
        this._hasLiveNativeSelection = liveInDoc !== null;
        if (!liveInDoc || this._isExternalInputFocused())
            return;
        this._setting = true;
        try {
            this._cacheText(liveInDoc);
            this._image.clear();
        }
        finally {
            this._setting = false;
        }
        if (this._suppressFocusScroll) {
            this._clearSuppressFocusScroll();
            this.preventScrollOnNextNotification();
        }
        this.notify(false, true);
    }

    syncTableSelection(state: ITableRectSelectionState | null) {
        if (this._setting || (!state && this.type !== SelectionType.TABLE))
            return;
        this._setting = true;
        try {
            this._state = copySelectionState(state);
            if (state) {
                this._text.collapse();
                this._image.clear();
            }
        }
        finally {
            this._setting = false;
        }
        this.notify(false, true);
    }

    private get _canNotify(): boolean {
        const { transactions, isUpdating, isComposing } = this._muya.editor;
        return !this._setting && !transactions.isActive && !isUpdating && !isComposing;
    }

    preventScrollOnNextNotification(): void {
        this._preventScroll = true;
    }

    notify(docChanged = false, deferred = false) {
        this._docChanged ||= docChanged;
        if (!this._canNotify)
            return;
        if (deferred) {
            this._frame ??= requestAnimationFrame(() => {
                this._frame = null;
                this.flush();
            });
        }
        else {
            this.flush();
        }
    }

    private _updateImageCaret(selection: TSelection | null) {
        const content = selection?.kind === SelectionType.TEXT && selection.context.isCollapsed && !this._muya.isReadOnly
            ? selection.context.anchorBlock.domNode
            : null;
        const caret = content ? imageCaret(content) : null;
        if (this._imageCaret) {
            const { atom, edge, element } = this._imageCaret;
            if (atom === caret?.atom && edge === caret.edge && element.isConnected)
                return;
            clearImageCaret(element);
        }
        this._imageCaret = caret ? { ...caret, element: paintImageCaret(caret) } : null;
    }

    flush() {
        if (!this._canNotify)
            return;
        if (this._frame !== null)
            cancelAnimationFrame(this._frame);
        this._frame = null;
        const selection = this.getSelection();
        this._updateImageCaret(selection);
        if (!selection && this._state) {
            this._setting = true;
            try {
                this._state = null;
                this._image.clear();
                this._table.clear();
                this._muya.editor.activeContentBlock = null;
                this._text.collapse();
            }
            finally {
                this._setting = false;
            }
        }
        const formats = selection?.kind === SelectionType.TEXT
            ? selection.context.formats.map(({ type, raw }) => [type, raw])
            : [];
        const signature = JSON.stringify([copySelectionState(selection), formats]);
        const docChanged = this._docChanged;
        const preventScroll = this._preventScroll;
        this._docChanged = false;
        this._preventScroll = false;
        if (!docChanged && signature === this._lastPublished)
            return;
        this._lastPublished = signature;
        this._muya.eventCenter.emit('selection-change', {
            selection,
            docChanged,
            ...(preventScroll && { preventScroll }),
        });
    }

    cancel() {
        if (this._imageCaret) {
            clearImageCaret(this._imageCaret.element);
            this._imageCaret = null;
        }
        if (this._frame !== null)
            cancelAnimationFrame(this._frame);
        this._frame = null;
        this._docChanged = false;
        this._preventScroll = false;
        this._lastPublished = '';
        this._hasLiveNativeSelection = false;
        this._pointerFocusing = false;
        if (this._pointerFocusTimer !== null) {
            clearTimeout(this._pointerFocusTimer);
            this._pointerFocusTimer = null;
        }
        this._clearSuppressFocusScroll();
    }

    private _resolve(state: TSelectionState): TSelection | null {
        switch (state.kind) {
            case SelectionType.TEXT:
                return this._resolveText(state);
            case SelectionType.IMAGE:
                return this._resolveImage(state);
            case SelectionType.TABLE:
                return this._resolveTable(state);
        }
    }

    private _resolveText(
        state: Extract<TSelectionState, { kind: SelectionType.TEXT }>,
        { includeFormats = true, validateOffsets = true } = {},
    ): ITextSelection | null {
        const endpoints = resolveTextSelectionEndpoints(this._muya, state, { validateOffsets });
        if (!endpoints)
            return null;
        const { anchor, focus } = endpoints;
        const { block: anchorBlock, path: anchorPath, offset: anchorOffset } = anchor;
        const { block: focusBlock, path: focusPath, offset: focusOffset } = focus;
        const isSelectionInSameBlock = anchorBlock === focusBlock;
        const isCollapsed = isSelectionInSameBlock && anchorOffset === focusOffset;
        const order = isSelectionInSameBlock
            ? anchorOffset - focusOffset
            : comparePaths(anchorPath, focusPath);
        let direction = SelectionDirection.NONE;
        if (!isCollapsed)
            direction = order < 0 ? SelectionDirection.FORWARD : SelectionDirection.BACKWARD;
        const format = anchorBlock as Format;
        const native = this._readNative();
        const cursorCoords = native ? getCursorCoords(direction === SelectionDirection.FORWARD) : null;
        const range = native ? document.getSelection()?.getRangeAt(0) : null;
        const formats = includeFormats && isSelectionInSameBlock && typeof format.getFormatsInRange === 'function'
            ? format.getFormatsInRange().formats
            : [];
        return {
            ...state,
            context: {
                anchorBlock,
                focusBlock,
                anchorBlockInfo: endpointBlockInfo(anchorBlock)!,
                focusBlockInfo: endpointBlockInfo(focusBlock)!,
                isCollapsed,
                isSelectionInSameBlock,
                direction,
                formats,
                affiliation: buildSelectionAffiliation(anchorBlock, focusBlock),
                cursorCoords,
                selectionCoords: range?.getBoundingClientRect?.() ?? cursorCoords,
            },
        };
    }

    private _resolveImage(
        state: Extract<TSelectionState, { kind: SelectionType.IMAGE }>,
    ): IImageSelection | null {
        const { path, range, raw } = state;
        const block = resolveContent(this._muya, path) as Format | null;
        if (!block?.domNode || range.start >= range.end
            || !isLegalOffset(block.text, range.start)
            || !isLegalOffset(block.text, range.end)
            || block.text.slice(range.start, range.end) !== raw) {
            return null;
        }
        const wrappers = block.domNode.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`);
        const wrapper = [...wrappers].find(node =>
            node.dataset.raw === raw && getOffsetOfParagraph(node, block.domNode!) === range.start,
        );
        if (!wrapper)
            return null;
        const imageInfo = getImageInfo(wrapper);
        const domNode = wrapper.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`);
        return {
            ...state,
            context: {
                block,
                imageInfo,
                domNode,
                affiliation: buildAffiliation(block),
                cursorCoords: null,
                selectionCoords: (domNode ?? wrapper).getBoundingClientRect(),
            },
        };
    }

    private _resolveTable(state: ITableRectSelectionState): ITableRectSelection | null {
        const { tablePath, anchor, focus } = state;
        const { row: anchorRow, column: anchorColumn } = anchor;
        const { row: focusRow, column: focusColumn } = focus;
        const block = this._muya.editor.scrollPage?.queryBlock([...tablePath]);
        if (block?.blockName !== 'table')
            return null;
        const table = block as Table;
        const coordinates = [anchorRow, anchorColumn, focusRow, focusColumn];
        if (!coordinates.every(Number.isInteger))
            return null;
        const anchorCell = table.cellAt(anchorRow, anchorColumn);
        const focusCell = table.cellAt(focusRow, focusColumn);
        if (!anchorCell || !focusCell)
            return null;
        const anchorRect = anchorCell.domNode?.getBoundingClientRect();
        const focusRect = focusCell.domNode?.getBoundingClientRect();
        let selectionCoords: TSelectionCoords | null = null;
        if (anchorRect && focusRect) {
            const left = Math.min(anchorRect.left, focusRect.left);
            const top = Math.min(anchorRect.top, focusRect.top);
            const right = Math.max(anchorRect.right, focusRect.right);
            const bottom = Math.max(anchorRect.bottom, focusRect.bottom);
            selectionCoords = {
                x: left,
                y: top,
                left,
                top,
                right,
                bottom,
                width: right - left,
                height: bottom - top,
            };
        }
        return {
            ...state,
            context: {
                table,
                anchorCell,
                focusCell,
                range: {
                    startRow: Math.min(anchorRow, focusRow),
                    endRow: Math.max(anchorRow, focusRow),
                    startColumn: Math.min(anchorColumn, focusColumn),
                    endColumn: Math.max(anchorColumn, focusColumn),
                },
                affiliation: buildSelectionAffiliation(anchorCell.firstContentInDescendant(), focusCell.firstContentInDescendant()),
                cursorCoords: null,
                selectionCoords,
            },
        };
    }

    getSelectedText(): string {
        const selection = this.getSelection();
        if (selection?.kind === SelectionType.TEXT) {
            const { anchor, focus, context } = selection;
            const { anchorBlock, focusBlock } = context;
            return this._text.getSelectedText({
                anchor: {
                    ...anchor,
                    path: [...anchor.path],
                    block: anchorBlock,
                },
                focus: {
                    ...focus,
                    path: [...focus.path],
                    block: focusBlock,
                },
                ...context,
            });
        }
        if (selection?.kind === SelectionType.TABLE) {
            const { table, range } = selection.context;
            const { startRow, endRow, startColumn, endColumn } = range;
            const rows: string[] = [];
            for (let row = startRow; row <= endRow; row++) {
                const cells: string[] = [];
                for (let column = startColumn; column <= endColumn; column++)
                    cells.push(table.cellAt(row, column)?.firstContentInDescendant()?.text ?? '');
                rows.push(cells.join('\t'));
            }
            return rows.join('\n');
        }
        return '';
    }

    selectAll(): void {
        if (this.type === SelectionType.IMAGE)
            this.clear();
        if (this._muya.isReadOnly) {
            this._table.clear();
            this._text.selectAllContent();
            this.syncTextSelection();
            this.flush();
            return;
        }

        const tableSelection = this._table;

        if (tableSelection.hasSelection) {
            if (tableSelection.isWholeTableSelected()) {
                tableSelection.clear();
                this._text.selectAllContent();
            }
            else {
                tableSelection.selectWholeTable();
            }
            return;
        }

        // The live caret may have moved since the last cached menu selection.
        const live = this.getTextSelection();
        const anchorBlock = live ? live.anchor.block : this._text.anchorBlock;
        const focusBlock = live ? live.focus.block : this._text.focusBlock;
        const anchorOffset = live ? live.anchor.offset : this._text.anchor?.offset;
        const focusOffset = live ? live.focus.offset : this._text.focus?.offset;

        // Undo may detach the cached block without restoring a caret (#5387).
        if (anchorBlock?.outMostBlock && anchorBlock === focusBlock && anchorOffset != null && focusOffset != null) {
            if (anchorBlock.blockName === 'table.cell.content') {
                const cellBlock = anchorBlock.closestBlock('table.cell') as TableBodyCell | null;
                if (cellBlock) {
                    tableSelection.selectSingleCell(cellBlock);
                    return;
                }
            }

            if (Math.abs(focusOffset - anchorOffset) < anchorBlock.text.length) {
                const path = anchorBlock.path;
                this._text.setSelection(
                    { offset: 0, block: anchorBlock, path },
                    { offset: anchorBlock.text.length, block: anchorBlock, path },
                );
                return;
            }
        }

        this._text.selectAllContent();
    }
}

export function getCursorReference() {
    const rect = getCursorCoords();
    return rect
        ? {
                getBoundingClientRect: () => rect,
                clientWidth: rect.width,
                clientHeight: rect.height,
            }
        : null;
}

export default Selection;
