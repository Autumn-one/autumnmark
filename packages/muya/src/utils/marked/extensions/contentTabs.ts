import type { MarkedExtension, Token, Tokens } from 'marked';
import { Lexer } from 'marked';
import { contentTabHeading, contentTabsMarker, findContentTabGroups } from '../../contentTabs';

function expandContentTabs(tokens: Token[], lexer: Lexer): void {
    const descriptions = tokens.map(token => ({
        marker: token.type === 'html' ? contentTabsMarker(token.raw) : undefined,
        heading: token.type === 'heading' ? contentTabHeading(token.raw.replace(/\r?\n$/, '')) : undefined,
    }));
    for (const group of findContentTabGroups(descriptions)) {
        for (const index of [group.start, group.end])
            tokens[index] = { type: 'space', raw: tokens[index].raw };
        for (const index of group.headings) {
            const heading = tokens[index] as Tokens.Heading;
            const text = descriptions[index].heading!.label;
            tokens[index] = { ...heading, text, tokens: lexer.inlineTokens(text) };
        }
    }
    for (const token of tokens) {
        if (token.type === 'list') {
            for (const item of token.items)
                expandContentTabs(item.tokens, lexer);
        }
        else if (['blockquote', 'githubAlert', 'multilineBlockquote', 'footnote'].includes(token.type) && 'tokens' in token && Array.isArray(token.tokens)) {
            expandContentTabs(token.tokens, lexer);
        }
    }
}

/** Static exports expand every panel so printing and script-free readers retain all content. */
export default function contentTabsExtension(): MarkedExtension {
    return {
        hooks: {
            processAllTokens(tokens) {
                const lexer = new Lexer(this.options);
                if ('links' in tokens)
                    lexer.tokens.links = tokens.links;
                expandContentTabs(tokens, lexer);
                return tokens;
            },
        },
    };
}
