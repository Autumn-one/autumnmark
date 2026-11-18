import type { MarkedExtension, Token, Tokens } from 'marked';
import { findFoldBlockGroups, foldBlockMarker, foldTitleStrong } from '../../foldBlocks';

interface IFoldToken {
    type: 'foldBlock';
    raw: string;
    defaultOpen: boolean;
    tokens: Token[];
}

function groupFoldTokens(tokens: Token[]): void {
    const groups = findFoldBlockGroups(tokens.map(token => ({
        marker: token.type === 'html' ? foldBlockMarker(token.raw) : undefined,
        space: token.type === 'space',
    })), (index) => {
        const token = tokens[index];
        return token.type === 'heading' || (token.type === 'paragraph'
            && Boolean(foldTitleStrong(token.tokens ?? [], token => token.type === 'em' ? token.tokens : undefined)));
    });
    if (!groups.length)
        return;
    const starts = new Map(groups.map(group => [group.start, group]));
    const result: Token[] = [];
    const frames = [{ end: tokens.length, children: result }];
    for (let index = 0; index < tokens.length; index++) {
        const frame = frames.at(-1)!;
        if (index === frame.end) {
            frames.pop();
            continue;
        }
        const group = starts.get(index);
        if (group) {
            const children = [tokens[group.title]];
            const fold: IFoldToken = { type: 'foldBlock', raw: tokens[index].raw, defaultOpen: group.defaultOpen, tokens: children };
            frame.children.push(fold);
            frames.push({ end: group.end, children });
            index = group.title;
        }
        else {
            frame.children.push(tokens[index]);
        }
    }
    tokens.length = 0;
    for (const token of result)
        tokens.push(token);
}

export default function foldBlocksExtension(expand = false): MarkedExtension {
    return {
        hooks: {
            processAllTokens(tokens) {
                groupFoldTokens(tokens);
                return tokens;
            },
        },
        extensions: [{
            name: 'foldBlock',
            childTokens: ['tokens'],
            renderer(token) {
                const { tokens, defaultOpen } = token as IFoldToken;
                const titleToken = tokens[0] as Tokens.Heading | Tokens.Paragraph;
                const title = titleToken.type === 'paragraph' ? this.parser.parseInline(titleToken.tokens) : this.parser.parse([titleToken]);
                const body = this.parser.parse(tokens.slice(1));
                return `<details class="mu-export-fold"${expand || defaultOpen ? ' open' : ''}>\n<summary>${title}</summary>\n${body}</details>\n`;
            },
        }],
    };
}
