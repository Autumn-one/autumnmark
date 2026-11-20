import type Content from '../block/base/content';
import type { TBlockPath } from '../block/types';
import type { ISelectionEndpoint } from '../selection/types';
import type { IMuyaOptions, Nullable } from '../types';
import type { IPastedImageSource } from './pastedImageSources';
import diff from 'fast-diff';
import { comparePaths, resolveContent } from '../selection/state';
import { SelectionType } from '../selection/types';
import { embeddedImageDestination, findPastedImageSources } from './pastedImageSources';

interface IPastedBlock {
    block: Content;
    text: string;
    images: IPastedImageSource[];
}

// An edit before a pending image can move it. Only map destinations that survived intact.
function liveImages({ block, text, images }: IPastedBlock) {
    if (block.text === text)
        return images;
    const live = new Map(findPastedImageSources(block.text).map(image => [image.start, image]));
    const matches: IPastedImageSource[] = [];
    let before = 0;
    let after = 0;
    let index = 0;
    for (const [op, part] of diff(text, block.text)) {
        if (op === 0) {
            while (index < images.length && images[index].start < before + part.length) {
                const image = images[index++];
                const mapped = live.get(after + image.start - before);
                if (image.start >= before && image.end <= before + part.length && mapped?.src === image.src)
                    matches.push(mapped);
            }
        }
        if (op !== 1)
            before += part.length;
        if (op !== -1)
            after += part.length;
    }
    return matches;
}

type TEmbedBatch = NonNullable<IMuyaOptions['embedPastedImages']>;

function pastedBlocks(target: Content, original: string, from: number, end: Content, endOffset: number, previousPath?: TBlockPath) {
    const blocks: IPastedBlock[] = [];
    const insidePaste = (block: Nullable<Content>): block is Content => !!block && (!previousPath || comparePaths(block.path, previousPath) > 0);
    let block: Nullable<Content> = end;
    while (insidePaste(block)) {
        const prior = block.previousContentInContext();
        const first = block === target || !insidePaste(prior);
        // A block-level HTML paste can leave the anchor entirely outside the inserted text.
        if (block === target && block !== end && block.text === original)
            break;
        if (block.blockName !== 'language-input' && (block.blockName !== 'codeblock.content' || block.closestBlock('html-block'))) {
            const start = first ? from : 0;
            const limit = block === end ? endOffset : block.text.length;
            const images = findPastedImageSources(block.text).filter(image => image.start >= start && image.end <= limit);
            if (images.length)
                blocks.push({ block, text: block.text, images });
        }
        if (first)
            break;
        block = prior;
    }
    return blocks;
}

export async function embedAfterPaste(target: Content, paste: () => void, embed: TEmbedBatch) {
    const { muya } = target;
    const previousPath = target.previousContentInContext()?.path;
    const { start } = target.getCursor()!;
    const original = target.text;
    paste();
    // The native caret can stop before an unloaded trailing image. The applied model endpoint includes it.
    const { focusBlock, focus } = muya.editor.selection;
    if (!focusBlock || !focus)
        return;
    const blocks = pastedBlocks(target, original, start.offset, focusBlock, focus.offset, previousPath);
    if (!blocks.length)
        return;
    const sources = await embed(blocks.flatMap(item => item.images.map(image => image.src)));
    if (!sources.size || muya.isReadOnly)
        return;
    const selection = muya.domNode.contains(document.activeElement) ? muya.getSelectionState() : null;
    const edits = new Map<Content, { start: number; end: number; src: string }[]>();
    for (const item of blocks) {
        if (!muya.isBlockInDocument(item.block) || (item.block === target && item.text !== original && item.block.text === original))
            continue;
        const replacements = liveImages(item).flatMap((image) => {
            const src = sources.get(image.src);
            return src ? [{ ...image, src: embeddedImageDestination(image, src) }] : [];
        });
        if (replacements.length)
            edits.set(item.block, replacements);
    }
    if (!edits.size)
        return;
    const mapPoint = (point: ISelectionEndpoint) => {
        const block = resolveContent(muya, point.path);
        let offset = point.offset;
        for (const edit of (block && edits.get(block)) || []) {
            if (point.offset > edit.start)
                offset += edit.src.length - (Math.min(point.offset, edit.end) - edit.start);
        }
        return { ...point, offset };
    };
    const cursor = selection?.kind === SelectionType.TEXT
        ? { ...selection, anchor: mapPoint(selection.anchor), focus: mapPoint(selection.focus) }
        : null;
    muya.transact(() => {
        for (const [block, replacements] of edits) {
            const parts: string[] = [];
            let last = 0;
            for (const { start, end, src } of replacements) {
                parts.push(block.text.slice(last, start), src);
                last = end;
            }
            block.text = parts.join('') + block.text.slice(last);
            block.update();
        }
        if (cursor)
            muya.setSelection(cursor);
    });
}
