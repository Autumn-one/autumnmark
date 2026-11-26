import type Format from '../block/base/format';
import type CodeBlockContent from '../block/content/codeBlockContent';
import type DiagramBlock from '../block/extra/diagram';
import type { ImageToken } from '../inline/model/types';
import type { Muya } from '../muya';
import type { TSelectionState } from '../selection/types';
import { tokenEvents } from '../inline/model/traversal';
import { parseInline } from '../inline/parser/lexer';
import { SelectionType } from '../selection/types';
import { decodeInlineDrawing, encodeInlineDrawing, INLINE_DRAWING_DATA_PREFIX, isInlineDrawingImage } from '../utils/diagram/drawingData';

export interface IUpdateEmbeddedDrawingParams {
    renderedIndex: number;
    expectedKind: 'inline' | 'fence';
    expectedSource: string;
    expectedEncodedSrc?: string;
    expectedMarkup?: string;
    nextSource: string;
    previewLoader?: () => Promise<string>;
    preventScroll?: boolean;
    preserveFocus?: boolean;
}

type TLiveDrawingEntry
    = | {
        kind: 'fence';
        diagram: DiagramBlock;
        content: CodeBlockContent;
    }
    | {
        kind: 'inline';
        block: Format;
        localIndex: number;
        token: ImageToken;
    };

export type TResolvedEmbeddedDrawingTarget
    = | {
        kind: 'fence';
        diagram: DiagramBlock;
        content: CodeBlockContent;
        changed: boolean;
    }
    | {
        kind: 'inline';
        block: Format;
        localIndex: number;
        token: ImageToken;
        oldRaw: string;
        oldEncodedSrc: string;
        nextEncodedSrc: string;
        nextRaw: string;
        srcStart: number;
        srcEnd: number;
        changed: boolean;
    };

function comparableScene(source: string): string {
    return source.split('\n').filter(line => line.trim()).join('\n').trim();
}

function collectLiveEmbeddedDrawings(muya: Muya): TLiveDrawingEntry[] {
    const entries: TLiveDrawingEntry[] = [];
    const scrollPage = muya.editor.scrollPage;
    if (!scrollPage)
        return entries;

    scrollPage.depthFirstTraverse((node) => {
        if (node.blockName === 'diagram') {
            const diagram = node as DiagramBlock;
            if (diagram.meta.type !== 'excalidraw')
                return;
            const content = diagram.firstContentInDescendant() as CodeBlockContent | null;
            if (content)
                entries.push({ kind: 'fence', diagram, content });
            return;
        }
        if (!node.isContent() || !('text' in node) || node.blockName === 'codeblock.content')
            return;
        const block = node as Format;
        if (!block.text.includes(INLINE_DRAWING_DATA_PREFIX))
            return;
        const tokens = parseInline(block.text);
        let localIndex = 0;
        for (const { token, exiting } of tokenEvents(tokens, t =>
            t.type !== 'image' && t.type !== 'reference_image'
            && (t.type !== 'html_tag' || t.tag !== 'ruby'))) {
            if (!exiting || !isInlineDrawingImage(token))
                continue;
            entries.push({ kind: 'inline', block, localIndex, token: token as ImageToken });
            localIndex += 1;
        }
    });
    return entries;
}

function pathsEqual(first: readonly (string | number)[], second: readonly (string | number)[]): boolean {
    return first.length === second.length && first.every((part, index) => part === second[index]);
}

function adjustSelectionForInlineEdit(
    selection: TSelectionState | null,
    blockPath: readonly (string | number)[],
    srcStart: number,
    srcEnd: number,
    nextEncodedLength: number,
    nextRaw: string,
): TSelectionState | null {
    if (!selection)
        return null;
    const delta = nextEncodedLength - (srcEnd - srcStart);
    if (delta === 0)
        return null;
    if (selection.kind === SelectionType.TEXT) {
        const shift = (offset: number) => {
            if (offset >= srcEnd)
                return offset + delta;
            if (offset > srcStart)
                return srcStart + nextEncodedLength;
            return offset;
        };
        const anchorMatches = pathsEqual(selection.anchor.path, blockPath);
        const focusMatches = pathsEqual(selection.focus.path, blockPath);
        if (!anchorMatches && !focusMatches)
            return null;
        return {
            kind: SelectionType.TEXT,
            anchor: anchorMatches
                ? { path: [...selection.anchor.path], offset: shift(selection.anchor.offset) }
                : { path: [...selection.anchor.path], offset: selection.anchor.offset },
            focus: focusMatches
                ? { path: [...selection.focus.path], offset: shift(selection.focus.offset) }
                : { path: [...selection.focus.path], offset: selection.focus.offset },
        };
    }
    if (selection.kind === SelectionType.IMAGE && pathsEqual(selection.path, blockPath)) {
        if (selection.range.start >= srcEnd) {
            return {
                ...selection,
                path: [...selection.path],
                range: {
                    start: selection.range.start + delta,
                    end: selection.range.end + delta,
                },
            };
        }
        if (selection.range.start <= srcStart && selection.range.end >= srcEnd) {
            return {
                ...selection,
                path: [...selection.path],
                range: {
                    start: selection.range.start,
                    end: selection.range.end + delta,
                },
                raw: nextRaw,
            };
        }
    }
    return null;
}

/** Pure verification phase: returns null without mutating any state when preconditions fail. */
export function resolveEmbeddedDrawingTarget(
    muya: Muya,
    params: IUpdateEmbeddedDrawingParams,
): TResolvedEmbeddedDrawingTarget | null {
    if (muya.isReadOnly || !muya.canMutate || !muya.editor.scrollPage)
        return null;
    if (!Number.isSafeInteger(params.renderedIndex) || params.renderedIndex < 0)
        return null;

    const entries = collectLiveEmbeddedDrawings(muya);
    const entry = entries[params.renderedIndex];
    if (!entry || entry.kind !== params.expectedKind)
        return null;

    if (entry.kind === 'fence') {
        if (comparableScene(entry.content.text) !== comparableScene(params.expectedSource))
            return null;
        return {
            kind: 'fence',
            diagram: entry.diagram,
            content: entry.content,
            changed: entry.content.text !== params.nextSource,
        };
    }

    const { token, block, localIndex } = entry;
    const oldRaw = block.text.slice(token.range.start, token.range.end);
    if (oldRaw !== token.raw)
        return null;
    if (params.expectedMarkup !== undefined && oldRaw !== params.expectedMarkup)
        return null;

    const decoded = decodeInlineDrawing(token.attrs.src);
    if (decoded === undefined || comparableScene(decoded) !== comparableScene(params.expectedSource))
        return null;

    const expectedEncodedSrc = params.expectedEncodedSrc ?? token.attrs.src;
    const destAnchor = oldRaw.lastIndexOf('](');
    if (destAnchor < 0)
        return null;
    const relStart = oldRaw.indexOf(expectedEncodedSrc, destAnchor + 2);
    if (relStart < 0 || oldRaw.includes(expectedEncodedSrc, relStart + 1))
        return null;

    const srcStart = token.range.start + relStart;
    const srcEnd = srcStart + expectedEncodedSrc.length;
    if (block.text.slice(srcStart, srcEnd) !== expectedEncodedSrc)
        return null;

    const nextEncodedSrc = encodeInlineDrawing(params.nextSource);
    const nextRaw = oldRaw.slice(0, relStart) + nextEncodedSrc + oldRaw.slice(relStart + expectedEncodedSrc.length);
    return {
        kind: 'inline',
        block,
        localIndex,
        token,
        oldRaw,
        oldEncodedSrc: expectedEncodedSrc,
        nextEncodedSrc,
        nextRaw,
        srcStart,
        srcEnd,
        changed: nextEncodedSrc !== expectedEncodedSrc,
    };
}

/** Commit phase: runs only after resolveEmbeddedDrawingTarget succeeds; preview updates run async afterwards. */
export function applyEmbeddedDrawingUpdate(
    muya: Muya,
    target: TResolvedEmbeddedDrawingTarget,
    params: IUpdateEmbeddedDrawingParams,
): void {
    if (!target.changed)
        return;

    const preventScroll = params.preventScroll ?? true;
    const preserveFocus = params.preserveFocus ?? true;

    if (target.kind === 'fence') {
        muya.editor.history.cutoff();
        muya.transact(() => {
            target.content.replaceTextRange(0, target.content.text.length, params.nextSource);
            target.content.syncPreviewText(params.nextSource);
            if (preventScroll)
                muya.editor.selection.preventScrollOnNextNotification();
        });
        muya.editor.history.cutoff();
        void target.diagram.preview?.update(params.nextSource, params.previewLoader);
        return;
    }

    const wrappers = target.block.domNode?.querySelectorAll<HTMLElement>('.mu-inline-drawing');
    const wrapper = wrappers?.[target.localIndex] ?? null;
    const canMutateWrapperInPlace = Boolean(
        wrapper
        && wrapper.getAttribute('data-raw') === target.oldRaw
        && wrapper.classList.contains('mu-image-success')
        && wrapper.querySelector('.mu-image-container > img'),
    );

    // Seed preview fallback and start loading before transact() so synchronous search
    // highlight refreshes on selection-change see the fallback and reuse previewLoader.
    const loadPromise = muya.editor.inlineEngine.prepareInlineDrawingSwap(
        wrapper,
        target.oldEncodedSrc,
        target.nextEncodedSrc,
        params.previewLoader,
    );

    const selectionBefore = muya.editor.selection.getSelectionState();
    const adjustedSelection = adjustSelectionForInlineEdit(
        selectionBefore,
        target.block.path,
        target.srcStart,
        target.srcEnd,
        target.nextEncodedSrc.length,
        target.nextRaw,
    );

    muya.editor.history.cutoff();
    muya.transact(() => {
        target.block.replaceTextRange(target.srcStart, target.srcEnd, target.nextEncodedSrc);
        if (canMutateWrapperInPlace && wrapper)
            wrapper.dataset.raw = target.nextRaw;
        else
            target.block.update();

        if (adjustedSelection) {
            muya.editor.selection.setSelection(adjustedSelection, {
                preventScroll,
                preserveFocus,
            });
        }
        if (preventScroll)
            muya.editor.selection.preventScrollOnNextNotification();
    });
    muya.editor.history.cutoff();

    const attrs = Object.fromEntries(
        Object.entries(target.token.attrs).filter((entry): entry is [string, string] => entry[1] !== null),
    );
    void muya.editor.inlineEngine.applyInlineDrawingSwap({
        block: target.block,
        localIndex: target.localIndex,
        wrapper,
        expectedRaw: target.nextRaw,
        attrs,
        loadPromise,
    });
}
