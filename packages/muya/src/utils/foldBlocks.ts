type TFoldMarker = 'closed' | 'open' | 'end';

export interface IFoldBlockDescription {
    marker?: TFoldMarker;
    heading?: boolean;
    space?: boolean;
}

export interface IFoldBlockGroup {
    start: number;
    title: number;
    end: number;
    defaultOpen: boolean;
}

export function foldBlockMarker(text: string): TFoldMarker | undefined {
    const match = /^ {0,3}<!--[ \t]*(?:fold(?:[ \t]+(open))?|(\/fold))[ \t]*-->[ \t]*(?:\r?\n)*$/.exec(text);
    if (match)
        return match[2] ? 'end' : match[1] ? 'open' : 'closed';
}

/** A complete group begins with a heading, keeping the fallback meaningful to Markdown readers. */
export function findFoldBlockGroups(blocks: readonly IFoldBlockDescription[]): IFoldBlockGroup[] {
    const groups: IFoldBlockGroup[] = [];
    const stack: Array<{ start: number; title: number; defaultOpen: boolean; nested: IFoldBlockGroup[] }> = [];
    for (const [index, block] of blocks.entries()) {
        if (block.marker === 'closed' || block.marker === 'open') {
            let title = index + 1;
            while (blocks[title]?.space)
                title++;
            stack.push({ start: index, title, defaultOpen: block.marker === 'open', nested: [] });
        }
        else if (block.marker === 'end') {
            const group = stack.pop();
            if (!group)
                continue;
            const target = stack.at(-1)?.nested ?? groups;
            if (group.title < index && blocks[group.title].heading)
                target.push({ start: group.start, title: group.title, end: index, defaultOpen: group.defaultOpen });
            for (const nested of group.nested)
                target.push(nested);
        }
    }
    return groups;
}
