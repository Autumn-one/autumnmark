export interface IContentTabHeading {
    label: string;
    prefixLength: number;
    source: string;
}

export interface IContentTabBlock {
    marker?: 'start' | 'end';
    heading?: IContentTabHeading;
}

export interface IContentTabGroup {
    start: number;
    end: number;
    headings: number[];
}

export function contentTabsMarker(text: string): 'start' | 'end' | undefined {
    const match = /^ {0,3}<!--[ \t]*(\/?)tabs[ \t]*-->[ \t]*(?:\r?\n)*$/.exec(text);
    return match ? (match[1] ? 'end' : 'start') : undefined;
}

/** Read the source line: marked's heading text has already lost trailing whitespace. */
export function contentTabHeading(text: string): IContentTabHeading | undefined {
    const match = /^( {0,3}#{1,6}[ \t]+)\\?\|[ \t]+/.exec(text);
    if (!match)
        return;
    const body = text.slice(match[0].length).replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
    return {
        label: body,
        prefixLength: match[0].length,
        source: match[1] + text.slice(match[0].length),
    };
}

/** Indices refer to direct siblings; an incomplete outer group leaves its entire source ordinary. */
export function findContentTabGroups(blocks: readonly IContentTabBlock[]): IContentTabGroup[] {
    const groups: IContentTabGroup[] = [];
    const stack: Array<IContentTabGroup & { nested: IContentTabGroup[] }> = [];
    blocks.forEach((block, index) => {
        if (block.marker === 'start') {
            stack.push({ start: index, end: -1, headings: [], nested: [] });
        }
        else if (block.marker === 'end') {
            const group = stack.pop();
            if (!group)
                return;
            group.end = index;
            const completed: IContentTabGroup[] = group.headings.length
                ? [{ start: group.start, end: group.end, headings: group.headings }, ...group.nested]
                : group.nested;
            const parent = stack.at(-1);
            if (parent)
                parent.nested.push(...completed);
            else
                groups.push(...completed);
        }
        else if (block.heading) {
            stack.at(-1)?.headings.push(index);
        }
    });
    return groups;
}
