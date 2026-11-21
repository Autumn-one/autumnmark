import type { Token } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
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

/** Keep the original root tokens for consumers that need exact source positions. */
export function lexSourceBlocks(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, frontMatter, footnote, multilineBlockquote, fancyLists } = options;
    const tokens: (Token | IFrontmatterToken)[] = [];

    // Per-call Marked instances prevent enabled extensions leaking into later calls.
    const m = new Marked(referenceDefinitionTabs(), tableLayoutExtension());

    if (texMathDollars) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (texMathGfm) {
        m.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (texMathSingleBackslash) {
        m.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (texMathDoubleBackslash) {
        m.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (footnote) {
        m.use(footnoteExtension());
    }

    m.use(multilineBlockquoteExtension(multilineBlockquote === true));

    if (fancyLists)
        m.use(fancyListsExtension());

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    // Lexer must receive this instance’s defaults to see its registered extensions.
    m.use(githubAlertsExtension(options.githubAlerts === true));
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
