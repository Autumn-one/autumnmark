import type { Token } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
import drawingLayoutExtension from './extensions/drawingLayout';
import fancyListsExtension, { endListItemsAtFancyMarkers } from './extensions/fancyLists';
import footnoteExtension from './extensions/footnote';
import githubAlertsExtension, { normalizeGithubAlertTokens } from './extensions/githubAlerts';
import mathExtension, { doubleBackslashMathExtension, gfmMathExtension, singleBackslashMathExtension } from './extensions/math';
import multilineBlockquoteExtension from './extensions/multilineBlockquote';
import referenceDefinitionTabs from './extensions/referenceDefinitionTabs';
import tableLayoutExtension from './extensions/tableLayout';
import fm from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import { restoreCodeTabs } from './restoreCodeTabs';
import walkTokens from './walkTokens';

const markedCache = new Map<string, Marked>();

function markedCacheKey(options: ILexOption): string {
    return [
        options.texMathDollars ? 1 : 0,
        options.texMathGfm ? 1 : 0,
        options.texMathSingleBackslash ? 1 : 0,
        options.texMathDoubleBackslash ? 1 : 0,
        options.footnote ? 1 : 0,
        options.multilineBlockquote === true ? 1 : 0,
        options.fancyLists ? 1 : 0,
        options.githubAlerts === true ? 1 : 0,
    ].join('');
}

function getMarkedInstance(options: ILexOption): Marked {
    const key = markedCacheKey(options);
    const cached = markedCache.get(key);
    if (cached)
        return cached;

    const m = new Marked(referenceDefinitionTabs(), tableLayoutExtension(), drawingLayoutExtension());

    if (options.texMathDollars) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (options.texMathGfm) {
        m.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (options.texMathSingleBackslash) {
        m.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (options.texMathDoubleBackslash) {
        m.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (options.footnote) {
        m.use(footnoteExtension());
    }

    m.use(multilineBlockquoteExtension(options.multilineBlockquote === true));

    if (options.fancyLists)
        m.use(fancyListsExtension());

    // Lexer must receive this instance’s defaults to see its registered extensions.
    m.use(githubAlertsExtension(options.githubAlerts === true));
    markedCache.set(key, m);
    return m;
}

/** Keep the original root tokens for consumers that need exact source positions. */
export function lexSourceBlocks(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { frontMatter, fancyLists } = options;
    const tokens: (Token | IFrontmatterToken)[] = [];

    const m = getMarkedInstance(options);

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    const lexer = new m.Lexer(m.defaults);
    if (fancyLists)
        endListItemsAtFancyMarkers(lexer);
    const parsed = lexer.blockTokens(src);
    if (src.includes('\t'))
        restoreCodeTabs(parsed, src);
    tokens.push(...parsed);
    return { tokens, lexer, marked: m };
}

export function lexBlock(src: string, options: ILexOption = DEFAULT_OPTIONS): TLexedToken[] {
    const { tokens: source, lexer, marked } = lexSourceBlocks(src, options);
    const tokens = compatibleTaskList(source as Token[]);
    if (options.githubAlerts)
        normalizeGithubAlertTokens(tokens as Token[], lexer);
    marked.walkTokens(tokens as Token[], walkTokens(options));

    // walkTokens and compatibleTaskList populate Muya fields absent from marked’s declared token types.
    return tokens as TLexedToken[];
}
