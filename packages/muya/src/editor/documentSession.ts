import type Content from '../block/base/content';
import type { IHistoryInternalState, ISerializedHistory } from '../history';
import type { Muya } from '../muya';
import type { TSelectionState } from '../selection/types';
import type { ITocItem } from '../state/getTOC';
import type { TState } from '../state/types';
import type { IDocumentContext, Nullable } from '../types';
import type { ICompactBlocksSessionState } from './compactBlocks';
import type { IContentTabsSessionState } from './contentTabs';
import type { IFoldBlocksSessionState } from './foldBlocks';
import { refreshFoldVisibility } from '../block/folding';
import { ScrollPage } from '../block/scrollPage';
import { createEmptyHistoryInternalState, serializeHistoryInternalState } from '../history';
import { getTOC } from '../state/getTOC';
import { createEmptyCompactBlocksSessionState } from './compactBlocks';
import { createEmptyContentTabsSessionState } from './contentTabs';
import { createEmptyFoldBlocksSessionState } from './foldBlocks';
import { prepareReadingLinks } from './readOnly';

export const DEFAULT_MAX_RETAINED_SESSIONS = 8;
export const DEFAULT_MAX_RETAINED_BLOCKS = 8000;
export const DEFAULT_MAX_RETAINED_CHARS = 1_500_000;

export interface IDocumentPoolLimits {
    maxSessions?: number;
    maxBlocks?: number;
    maxChars?: number;
}

export interface IActivateDocumentOptions {
    id: string;
    markdown: string;
    context: IDocumentContext;
    readOnly: boolean;
    searchOpen?: boolean;
    scrollTop?: number;
    onEvict?: (id: string, history: ISerializedHistory) => void;
    onPhase?: (stage: 'attach' | 'reading' | 'layout', start: number) => void;
}

export interface IActivateDocumentResult {
    hotHit: boolean;
    blocks: number;
    historyLength: number;
    toc: ITocItem[];
    restoredSelection: TSelectionState | null;
    restoredScrollTop: number | null;
    outgoingScrollTop?: number;
}

export interface IPrewarmDocumentOptions {
    id: string;
    markdown: string;
    context: IDocumentContext;
    readOnly: boolean;
    onEvict?: (id: string, history: ISerializedHistory) => void;
}

export interface IIdleDocumentPrewarm {
    /** Returns true once the task has settled. Retention is reported by the pool. */
    advance: (timeRemaining: () => number) => boolean;
    cancel: () => void;
}

interface IPreparedDocument {
    state: TState[];
    page: ScrollPage;
    compact: ICompactBlocksSessionState;
}

interface IIdlePreparation {
    options: IPrewarmDocumentOptions;
    generation: number;
    take: () => { prepared: IPreparedDocument; next: number };
    cancel: () => void;
}

interface IDocumentSession {
    id: string;
    context: IDocumentContext;
    scrollPage: ScrollPage | null;
    stateSnapshot: { state: TState[]; revision: number };
    historyState: IHistoryInternalState;
    compactState: ICompactBlocksSessionState;
    foldState: IFoldBlocksSessionState;
    contentTabsState: IContentTabsSessionState;
    highlightedBlocks: Set<Content>;
    tocCache: { revision: number; items: ITocItem[] } | null;
    scrollTop: number;
    selection: TSelectionState | null;
    sourceMarkdown: string;
    readOnly: boolean;
    optionsGeneration: number;
    blockCount: number;
    charCount: number;
    needsLayoutRefresh: boolean;
}

export function countStateBlocks(states: readonly TState[]): number {
    let count = 0;
    const stack: (readonly TState[])[] = [states];
    while (stack.length > 0) {
        const list = stack.pop()!;
        for (let i = 0; i < list.length; i++) {
            count++;
            const block = list[i]!;
            if ('children' in block && Array.isArray(block.children) && block.children.length > 0)
                stack.push(block.children as readonly TState[]);
        }
    }
    return count;
}

function pauseDetachedMedia(domNode: Nullable<HTMLElement>): void {
    if (!domNode || typeof domNode.querySelectorAll !== 'function')
        return;
    for (const video of domNode.querySelectorAll('video')) {
        try {
            if (!video.paused)
                video.pause();
        }
        catch {
            // Ignore detached media elements in non-browser test environments.
        }
    }
}

function disposeScrollPageResources(scrollPage: Nullable<ScrollPage>): void {
    if (!scrollPage)
        return;
    scrollPage.disposeDetachedResources();
    pauseDetachedMedia(scrollPage.domNode);
    scrollPage.breadthFirstTraverse((node) => {
        const disconnect = (node as { disconnectLayoutObserver?: () => void }).disconnectLayoutObserver;
        if (typeof disconnect === 'function')
            disconnect.call(node);
    });
}

function sameContextPath(a: IDocumentContext, b: IDocumentContext): boolean {
    return (a.pathname ?? '') === (b.pathname ?? '') && (a.dirname ?? '') === (b.dirname ?? '');
}

/**
 * Single-Muya LRU pool of detached ScrollPage document sessions.
 * Preserves JSONState, History, EditTransactions, Selection, Search, and view controller
 * object identities (B1) by swapping only their internal fields on tab activation.
 */
export class DocumentSessionPool {
    private _sessions = new Map<string, IDocumentSession>();
    private _idlePreparation: IIdlePreparation | null = null;
    private _activeId: string | null = null;
    private _activeSourceMarkdown = '';
    private _activeContext: IDocumentContext | null = null;
    private _activeTocCache: { revision: number; items: ITocItem[] } | null = null;
    private _optionsGeneration = 0;
    private readonly _maxSessions: number;
    private readonly _maxBlocks: number;
    private readonly _maxChars: number;

    constructor(private _muya: Muya, limits: IDocumentPoolLimits = {}) {
        this._maxSessions = limits.maxSessions ?? DEFAULT_MAX_RETAINED_SESSIONS;
        this._maxBlocks = limits.maxBlocks ?? DEFAULT_MAX_RETAINED_BLOCKS;
        this._maxChars = limits.maxChars ?? DEFAULT_MAX_RETAINED_CHARS;
    }

    get activeId(): string | null {
        return this._activeId;
    }

    get optionsGeneration(): number {
        return this._optionsGeneration;
    }

    get retainedDomCount(): number {
        let count = 0;
        for (const session of this._sessions.values()) {
            if (session.scrollPage)
                count++;
        }
        return count;
    }

    bindActive(id: string, markdown: string, context: IDocumentContext): void {
        this._activeId = id;
        this._activeSourceMarkdown = markdown;
        this._activeContext = context;
        this._activeTocCache = null;
        this._muya.editor.setDocumentContext(context);
    }

    changeContext(context: IDocumentContext, onEvict?: (id: string, history: ISerializedHistory) => void): void {
        if (context.id !== this._activeId) {
            this.evict(context.id, onEvict);
            return;
        }
        const previous = this._activeContext;
        this._activeContext = context;
        this._muya.editor.setDocumentContext(context);
        if ((previous?.dirname ?? '') !== (context.dirname ?? '')) {
            const selection = this._muya.getSelectionState();
            this._muya.editor.inlineEngine.refreshDocumentImageSources();
            if (selection)
                this._muya.setSelection(selection, { preventScroll: true, preserveFocus: true });
        }
    }

    markActiveModified(markdown: string): void {
        this._activeSourceMarkdown = markdown;
        this._activeTocCache = null;
    }

    invalidateAll(): void {
        this._optionsGeneration += 1;
        this._activeTocCache = null;
    }

    hasRetained(id: string, markdown: string, pathname?: string, dirname?: string): boolean {
        if (id === this._activeId) {
            return this._activeSourceMarkdown === markdown
                && (this._activeContext?.pathname ?? '') === (pathname ?? '')
                && (dirname === undefined || (this._activeContext?.dirname ?? '') === dirname);
        }
        const session = this._sessions.get(id);
        return !!session
            && session.scrollPage !== null
            && session.sourceMarkdown === markdown
            && session.optionsGeneration === this._optionsGeneration
            && (session.context.pathname ?? '') === (pathname ?? '')
            && (dirname === undefined || (session.context.dirname ?? '') === dirname);
    }

    getCachedTOC(): ITocItem[] {
        const revision = this._muya.editor.jsonState.revision;
        if (this._activeTocCache && this._activeTocCache.revision === revision)
            return this._activeTocCache.items;
        const items = getTOC(this._muya);
        this._activeTocCache = { revision, items };
        return items;
    }

    evict(id: string, onEvict?: (id: string, history: ISerializedHistory) => void): void {
        if (this._idlePreparation?.options.id === id)
            this._idlePreparation.cancel();
        const session = this._sessions.get(id);
        if (!session)
            return;
        this._sessions.delete(id);
        if (onEvict && (session.historyState.stack.undo.length > 0 || session.historyState.stack.redo.length > 0))
            onEvict(id, serializeHistoryInternalState(session.historyState));
        disposeScrollPageResources(session.scrollPage);
        session.scrollPage = null;
    }

    private _captureOutgoingActive(): number | undefined {
        const id = this._activeId;
        const { editor, domNode } = this._muya;
        if (!id || !editor.scrollPage || !this._activeContext)
            return;

        this._muya.flush();
        this._muya.ui.hideAllFloatTools();
        editor.textDrag?.cancel(false);
        editor.transactions.cancel();
        editor.codeLayoutScheduler.clear();
        pauseDetachedMedia(editor.scrollPage.domNode);

        const stateSnapshot = editor.jsonState.exportInternalState();
        const historyState = editor.history.exportInternalState();
        const compactState = editor.compactBlocks.exportSessionState();
        const foldState = editor.foldBlocks.exportSessionState();
        const contentTabsState = editor.contentTabs.exportSessionState();
        const highlightedBlocks = editor.searchModule.exportHighlightedBlocks();
        const selection = this._muya.getSelectionState();
        const scrollTop = domNode.scrollTop;
        const blockCount = countStateBlocks(stateSnapshot.state);
        const charCount = this._activeSourceMarkdown.length;

        const oversized = blockCount > this._maxBlocks || charCount > this._maxChars;
        const retainedScrollPage = oversized ? null : editor.scrollPage;
        if (oversized)
            disposeScrollPageResources(editor.scrollPage);

        const session: IDocumentSession = {
            id,
            context: this._activeContext,
            scrollPage: retainedScrollPage,
            stateSnapshot,
            historyState,
            compactState: oversized ? createEmptyCompactBlocksSessionState() : compactState,
            foldState: oversized ? createEmptyFoldBlocksSessionState() : foldState,
            contentTabsState: oversized ? createEmptyContentTabsSessionState() : contentTabsState,
            highlightedBlocks: oversized ? new Set() : highlightedBlocks,
            tocCache: this._activeTocCache,
            scrollTop,
            selection,
            sourceMarkdown: this._activeSourceMarkdown,
            readOnly: this._muya.isReadOnly,
            optionsGeneration: this._optionsGeneration,
            blockCount,
            charCount,
            needsLayoutRefresh: false,
        };
        this._sessions.delete(id);
        this._sessions.set(id, session);
        return scrollTop;
    }

    private _enforceBudget(excludeId: string, onEvict?: (id: string, history: ISerializedHistory) => void): void {
        let totalSessions = 0;
        let totalBlocks = 0;
        let totalChars = 0;
        for (const session of this._sessions.values()) {
            if (!session.scrollPage)
                continue;
            totalSessions++;
            totalBlocks += session.blockCount;
            totalChars += session.charCount;
        }

        for (const [id, session] of this._sessions) {
            if (totalSessions <= this._maxSessions && totalBlocks <= this._maxBlocks && totalChars <= this._maxChars)
                break;
            if (id === excludeId || !session.scrollPage)
                continue;
            totalSessions--;
            totalBlocks -= session.blockCount;
            totalChars -= session.charCount;
            this.evict(id, onEvict);
        }
    }

    private _attachScrollPageDom(nextPage: ScrollPage, prevPage: Nullable<ScrollPage>): void {
        const { domNode } = this._muya;
        if (prevPage?.domNode && prevPage.domNode.parentNode === domNode)
            domNode.replaceChild(nextPage.domNode!, prevPage.domNode);
        else
            domNode.replaceChildren(nextPage.domNode!);
        prevPage?.previewScope?.setActive(false);
    }

    activate(options: IActivateDocumentOptions): IActivateDocumentResult {
        const { id, markdown, context, readOnly, onEvict, onPhase } = options;
        const { editor } = this._muya;

        if (this._activeId === id && editor.scrollPage && this._activeSourceMarkdown === markdown && sameContextPath(this._activeContext ?? context, context)) {
            editor.syncPreviewVisibility();
            if (this._muya.isReadOnly !== readOnly)
                this._muya.setReadOnly(readOnly);
            const toc = this.getCachedTOC();
            return {
                hotHit: true,
                blocks: countStateBlocks(editor.jsonState.rawState),
                historyLength: editor.history.length,
                toc,
                restoredSelection: this._muya.getSelectionState(),
                restoredScrollTop: this._muya.domNode.scrollTop,
            };
        }

        const prevScrollPage = editor.scrollPage;
        const outgoingId = this._activeId;
        const outgoingScrollTop = this._activeId && this._activeId !== id
            ? this._captureOutgoingActive()
            : undefined;

        const cached = this._sessions.get(id);
        this._sessions.delete(id);

        const canHotSwap = !!cached
            && cached.scrollPage !== null
            && cached.sourceMarkdown === markdown
            && cached.optionsGeneration === this._optionsGeneration
            && sameContextPath(cached.context, context);

        if (canHotSwap && cached) {
            editor.selection.cancel();
            editor.isUpdating = true;
            try {
                editor.selection.clear();
                editor.activeContentBlock = null;
                editor.setDocumentContext(context);
                let start = onPhase ? performance.now() : 0;
                this._attachScrollPageDom(cached.scrollPage!, prevScrollPage);
                onPhase?.('attach', start);
                editor.scrollPage = cached.scrollPage;
                editor.jsonState.importInternalState(cached.stateSnapshot);
                editor.history.importInternalState(cached.historyState);
                editor.compactBlocks.importSessionState(cached.compactState);
                editor.foldBlocks.importSessionState(cached.foldState);
                editor.contentTabs.importSessionState(cached.contentTabsState);

                this._activeId = id;
                this._activeSourceMarkdown = markdown;
                this._activeContext = context;
                this._activeTocCache = cached.tocCache;

                const readOnlyChanged = cached.readOnly !== readOnly;
                const rootModeChanged = this._muya.isReadOnly !== readOnly;
                this._muya.options.readOnly = readOnly;
                start = onPhase ? performance.now() : 0;
                if (rootModeChanged || readOnlyChanged)
                    this._muya.syncReadingPresentation(readOnlyChanged, readOnlyChanged);
                onPhase?.('reading', start);
                if (rootModeChanged || readOnlyChanged)
                    this._muya.eventCenter.emit('read-only-changed', readOnly);

                if (cached.highlightedBlocks.size > 0)
                    editor.searchModule.clearBlocksHighlights(cached.highlightedBlocks);

                if (cached.needsLayoutRefresh) {
                    start = onPhase ? performance.now() : 0;
                    cached.needsLayoutRefresh = false;
                    editor.compactBlocks.refresh();
                    cached.scrollPage!.breadthFirstTraverse((node) => {
                        if (node.blockName === 'codeblock.content') {
                            const sync = (node as { syncCodeDecorations?: () => void }).syncCodeDecorations;
                            if (typeof sync === 'function')
                                sync.call(node);
                        }
                    });
                    onPhase?.('layout', start);
                }
            }
            finally {
                editor.isUpdating = false;
            }

            const toc = this.getCachedTOC();
            editor.syncPreviewVisibility();
            this._enforceBudget(id, onEvict);
            return {
                hotHit: true,
                blocks: cached.blockCount,
                historyLength: editor.history.length,
                toc,
                restoredSelection: cached.selection,
                restoredScrollTop: cached.scrollTop,
                outgoingScrollTop,
            };
        }

        // Cold build path (may reuse pre-parsed TState[] if session was state-only and fresh).
        if (cached?.scrollPage)
            disposeScrollPageResources(cached.scrollPage);

        const idle = this._takeIdlePreparation(options);
        const reuseState = cached
            && cached.sourceMarkdown === markdown
            && cached.optionsGeneration === this._optionsGeneration
            ? cached.stateSnapshot
            : null;
        const reuseHistory = cached
            && cached.sourceMarkdown === markdown
            ? cached.historyState
            : null;

        editor.selection.cancel();
        editor.isUpdating = true;
        let blocks = 0;
        try {
            editor.selection.clear();
            editor.activeContentBlock = null;
            editor.setDocumentContext(context);
            const prevReadOnly = this._muya.isReadOnly;
            this._muya.options.readOnly = readOnly;

            editor.compactBlocks.importSessionState(createEmptyCompactBlocksSessionState());
            editor.foldBlocks.importSessionState(createEmptyFoldBlocksSessionState());
            editor.contentTabs.importSessionState(createEmptyContentTabsSessionState());
            editor.searchModule.reset();

            const nextState = idle?.prepared.state ?? reuseState?.state ?? editor.jsonState.markdownToState(markdown);
            blocks = countStateBlocks(nextState);
            editor.jsonState.importInternalState({
                state: nextState,
                revision: !idle && reuseState ? reuseState.revision : editor.jsonState.revision + 1,
            });

            const nextPage = this._muya.runDocumentUpdate(() => {
                if (!idle)
                    return ScrollPage.createDetached(this._muya, nextState);
                const { page, compact } = idle.prepared;
                editor.compactBlocks.importSessionState(compact);
                page.appendDetachedBlocks(nextState.slice(idle.next));
                return page;
            });
            this._attachScrollPageDom(nextPage, prevScrollPage);
            editor.scrollPage = nextPage;
            if (!outgoingId || this._sessions.get(outgoingId)?.scrollPage !== prevScrollPage)
                disposeScrollPageResources(prevScrollPage);
            refreshFoldVisibility(nextPage);
            editor.refreshBlockViews();

            editor.history.importInternalState(reuseHistory ?? createEmptyHistoryInternalState());

            this._activeId = id;
            this._activeSourceMarkdown = markdown;
            this._activeContext = context;
            this._activeTocCache = null;

            this._muya.syncReadingPresentation(false);
            if (prevReadOnly !== readOnly)
                this._muya.eventCenter.emit('read-only-changed', readOnly);
        }
        catch (error) {
            if (idle && editor.scrollPage !== idle.prepared.page)
                disposeScrollPageResources(idle.prepared.page);
            throw error;
        }
        finally {
            editor.isUpdating = false;
        }

        const toc = this.getCachedTOC();
        editor.syncPreviewVisibility();
        this._enforceBudget(id, onEvict);
        return {
            hotHit: false,
            blocks,
            historyLength: editor.history.length,
            toc,
            restoredSelection: null,
            restoredScrollTop: null,
        };
    }

    /**
     * Build a detached ScrollPage offscreen for an inactive tab without perturbing
     * the active DOM, Selection, History, Search, or ambient window.DIRNAME.
     */
    prewarm(options: IPrewarmDocumentOptions): boolean {
        return this._prewarm(options);
    }

    createIdlePrewarm(options: IPrewarmDocumentOptions): IIdleDocumentPrewarm | null {
        const { editor } = this._muya;
        if (options.id === this._activeId || editor.isUpdating || editor.transactions.isActive)
            return null;
        const state = editor.jsonState.markdownToState(options.markdown);
        if (countStateBlocks(state) > this._maxBlocks || options.markdown.length > this._maxChars)
            return null;
        this._idlePreparation?.cancel();
        const prepared: IPreparedDocument = {
            state,
            page: new ScrollPage(this._muya),
            compact: createEmptyCompactBlocksSessionState(),
        };
        const generation = this._optionsGeneration;
        let next = 0;
        let finished = false;
        const release = () => {
            finished = true;
            this._idlePreparation = null;
        };
        const cancel = () => {
            if (finished)
                return;
            release();
            disposeScrollPageResources(prepared.page);
        };
        this._idlePreparation = {
            options,
            generation,
            take: () => {
                release();
                return { prepared, next };
            },
            cancel,
        };
        return {
            advance: (timeRemaining) => {
                if (finished)
                    return true;
                if (options.id === this._activeId || generation !== this._optionsGeneration) {
                    cancel();
                    return true;
                }
                if (editor.isUpdating || editor.transactions.isActive)
                    return false;
                try {
                    if (next < state.length)
                        next = this._buildIdleBlocks(options, prepared, next, timeRemaining);
                    if (next < state.length || timeRemaining() < 2)
                        return false;
                    const retained = this._prewarm(options, prepared);
                    if (!retained)
                        cancel();
                    else
                        release();
                    return true;
                }
                catch (error) {
                    cancel();
                    throw error;
                }
            },
            cancel,
        };
    }

    private _takeIdlePreparation(options: IActivateDocumentOptions): ReturnType<IIdlePreparation['take']> | null {
        const pending = this._idlePreparation;
        if (!pending)
            return null;
        const saved = pending.options;
        if (saved.id !== options.id || saved.markdown !== options.markdown
            || saved.readOnly !== options.readOnly || pending.generation !== this._optionsGeneration
            || !sameContextPath(saved.context, options.context)) {
            pending.cancel();
            return null;
        }
        return pending.take();
    }

    private _buildIdleBlocks(options: IPrewarmDocumentOptions, prepared: IPreparedDocument, next: number, timeRemaining: () => number): number {
        const { editor } = this._muya;
        const liveState = editor.jsonState.exportInternalState();
        const liveContext = editor.documentContext;
        const liveReadOnly = this._muya.options.readOnly;
        editor.isUpdating = true;
        editor.prewarmingDocument = true;
        try {
            editor.setDocumentContext(options.context);
            this._muya.options.readOnly = options.readOnly;
            editor.jsonState.importInternalState({ state: prepared.state, revision: 1 });
            return editor.compactBlocks.withDetachedBodies(prepared.compact, () => this._muya.runDocumentUpdate(() => {
                while (next < prepared.state.length && timeRemaining() >= 2) {
                    prepared.page.appendDetachedBlocks([prepared.state[next]!]);
                    next++;
                }
                return next;
            }));
        }
        finally {
            editor.prewarmingDocument = false;
            editor.setDocumentContext(liveContext);
            this._muya.options.readOnly = liveReadOnly;
            editor.jsonState.importInternalState(liveState);
            editor.isUpdating = false;
        }
    }

    private _prewarm(options: IPrewarmDocumentOptions, prepared?: IPreparedDocument): boolean {
        const { id, markdown, context, readOnly, onEvict } = options;
        if (id === this._activeId)
            return false;
        const existing = this._sessions.get(id);
        if (
            existing?.scrollPage
            && existing.sourceMarkdown === markdown
            && existing.optionsGeneration === this._optionsGeneration
            && sameContextPath(existing.context, context)
        ) {
            return false;
        }

        const { editor } = this._muya;
        if (editor.transactions.isActive || editor.isUpdating)
            return false;

        const charCount = markdown.length;
        const parsedState = prepared?.state ?? editor.jsonState.markdownToState(markdown);
        const blockCount = countStateBlocks(parsedState);

        // Enforce single-doc and remaining budget caps (M2): oversized docs keep state-only.
        let retainedBlocks = 0;
        let retainedChars = 0;
        for (const [sid, s] of this._sessions) {
            if (sid !== id && s.scrollPage) {
                retainedBlocks += s.blockCount;
                retainedChars += s.charCount;
            }
        }
        const canRetainDom = blockCount <= this._maxBlocks
            && charCount <= this._maxChars
            && (retainedBlocks + blockCount <= this._maxBlocks || this._sessions.size > 0)
            && (retainedChars + charCount <= this._maxChars || this._sessions.size > 0);

        if (!canRetainDom) {
            disposeScrollPageResources(prepared?.page);
            if (existing?.scrollPage)
                disposeScrollPageResources(existing.scrollPage);
            this._sessions.set(id, {
                id,
                context,
                scrollPage: null,
                stateSnapshot: { state: parsedState, revision: 1 },
                historyState: existing?.historyState ?? createEmptyHistoryInternalState(),
                compactState: createEmptyCompactBlocksSessionState(),
                foldState: createEmptyFoldBlocksSessionState(),
                contentTabsState: createEmptyContentTabsSessionState(),
                highlightedBlocks: new Set(),
                tocCache: null,
                scrollTop: existing?.scrollTop ?? 0,
                selection: existing?.selection ?? null,
                sourceMarkdown: markdown,
                readOnly,
                optionsGeneration: this._optionsGeneration,
                blockCount,
                charCount,
                needsLayoutRefresh: false,
            });
            return true;
        }

        // Snapshot live controller fields so we restore them verbatim in finally.
        const liveState = editor.jsonState.exportInternalState();
        const liveCompact = editor.compactBlocks.exportSessionState();
        const liveFold = editor.foldBlocks.exportSessionState();
        const liveTabs = editor.contentTabs.exportSessionState();
        const liveScrollPage = editor.scrollPage;
        const liveReadOnly = this._muya.options.readOnly;
        const liveContext = editor.documentContext;

        let detachedPage: ScrollPage | null = null;
        let detachedCompact = createEmptyCompactBlocksSessionState();
        let detachedFold = createEmptyFoldBlocksSessionState();
        let detachedTabs = createEmptyContentTabsSessionState();
        let tocItems: ITocItem[] = [];

        editor.isUpdating = true;
        editor.prewarmingDocument = true;
        try {
            editor.setDocumentContext(context);
            this._muya.options.readOnly = readOnly;
            editor.jsonState.importInternalState({ state: parsedState, revision: 1 });
            if (prepared)
                editor.compactBlocks.importSessionState(prepared.compact);
            detachedPage = prepared?.page ?? this._muya.runDocumentUpdate(() => ScrollPage.createDetached(this._muya, parsedState));
            editor.scrollPage = detachedPage;
            refreshFoldVisibility(detachedPage);
            editor.foldBlocks.refresh();
            editor.contentTabs.refresh();
            if (readOnly && detachedPage.domNode) {
                detachedPage.breadthFirstTraverse((node) => {
                    if (node.isContent())
                        node.domNode?.setAttribute('contenteditable', 'false');
                });
                prepareReadingLinks(detachedPage.domNode);
            }
            tocItems = getTOC(this._muya);
            detachedCompact = editor.compactBlocks.exportSessionState();
            detachedFold = editor.foldBlocks.exportSessionState();
            detachedTabs = editor.contentTabs.exportSessionState();
        }
        catch (error) {
            disposeScrollPageResources(detachedPage);
            throw error;
        }
        finally {
            editor.prewarmingDocument = false;
            editor.setDocumentContext(liveContext);
            this._muya.options.readOnly = liveReadOnly;
            editor.jsonState.importInternalState(liveState);
            editor.scrollPage = liveScrollPage;
            editor.compactBlocks.importSessionState(liveCompact);
            editor.foldBlocks.importSessionState(liveFold);
            editor.contentTabs.importSessionState(liveTabs);
            editor.isUpdating = false;
        }

        if (existing?.scrollPage)
            disposeScrollPageResources(existing.scrollPage);

        this._sessions.set(id, {
            id,
            context,
            scrollPage: detachedPage,
            stateSnapshot: { state: parsedState, revision: 1 },
            historyState: existing?.historyState ?? createEmptyHistoryInternalState(),
            compactState: detachedCompact,
            foldState: detachedFold,
            contentTabsState: detachedTabs,
            highlightedBlocks: new Set(),
            tocCache: { revision: 1, items: tocItems },
            scrollTop: existing?.scrollTop ?? 0,
            selection: existing?.selection ?? null,
            sourceMarkdown: markdown,
            readOnly,
            optionsGeneration: this._optionsGeneration,
            blockCount,
            charCount,
            needsLayoutRefresh: true,
        });
        this._enforceBudget(this._activeId ?? id, onEvict);
        return true;
    }

    dispose(): void {
        this._idlePreparation?.cancel();
        disposeScrollPageResources(this._muya.editor.scrollPage);
        for (const session of this._sessions.values())
            disposeScrollPageResources(session.scrollPage);
        this._sessions.clear();
        this._activeId = null;
        this._activeTocCache = null;
    }
}
