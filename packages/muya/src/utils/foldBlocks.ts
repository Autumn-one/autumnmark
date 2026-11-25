type TFoldMarker = 'closed' | 'open' | 'end';

export interface IFoldBlockDescription {
    marker?: TFoldMarker;
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

/** A title occupies its own inline scope, possibly wrapped in italic emphasis. */
export function foldTitleStrong<T extends { type: string; raw: string }>(
    tokens: readonly T[],
    emphasisChildren: (token: T) => readonly T[] | undefined,
): T | undefined {
    for (let scope: readonly T[] | undefined = tokens; scope;) {
        const content = scope.filter(token => token.type !== 'text' || token.raw.trim());
        if (content.length !== 1)
            return;
        if (content[0].type === 'strong')
            return content[0];
        if (content[0].type !== 'em')
            return;
        scope = emphasisChildren(content[0]);
    }
}

/** Test titles only at paired markers so ordinary paragraphs need no inline parsing. */
export function findFoldBlockGroups(blocks: readonly IFoldBlockDescription[], isTitle: (index: number) => boolean): IFoldBlockGroup[] {
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
            if (group.title < index && isTitle(group.title))
                target.push({ start: group.start, title: group.title, end: index, defaultOpen: group.defaultOpen });
            for (const nested of group.nested)
                target.push(nested);
        }
    }
    return groups;
}
