import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type { IInlineParseOptions } from '../inline/parser/types';
import type { Muya } from '../muya';
import { parseInline } from '../inline/parser/lexer';
import { tokensToInlineHtml, tokensToPlainText } from '../inline/projection';
import { getUniqueId } from '../utils';
import { generateGithubSlug, uniqueHeadingSlug } from '../utils/slug';

export interface ITocItem {
    content: string;
    contentHtml: string;
    lvl: number;
    slug: string;
    githubSlug: string;
    anchor: string;
}

interface IHeadingBlock extends Parent {
    meta: { level: number };
}

const slugCache = new WeakMap<Parent, string>();

export function headingLabel(text: string, parseOptions: IInlineParseOptions, seen: Set<string>) {
    const tokens = parseInline(text, parseOptions);
    const content = tokensToPlainText(tokens).trim();
    return {
        content,
        contentHtml: tokensToInlineHtml(tokens).trim(),
        githubSlug: generateGithubSlug(content),
        anchor: uniqueHeadingSlug(content, seen),
    };
}

export function stableSlug(block: Parent): string {
    let slug = slugCache.get(block);
    if (slug == null) {
        slug = getUniqueId();
        slugCache.set(block, slug);
    }
    return slug;
}

export function getTOC(muya: Muya): ITocItem[] {
    const { scrollPage } = muya.editor;
    if (!scrollPage)
        return [];

    // Headings are tokenized outside a rendered block, so the reference
    // definitions a heading may link to (`[text][ref]`) have to be collected
    // here instead of from the block's own inline renderer.
    const labels = muya.editor.inlineEngine.collectReferenceDefinitions();

    const items: ITocItem[] = [];
    const seen = new Set<string>();

    for (const node of scrollPage.children.iterator()) {
        const { blockName } = node;
        if (blockName !== 'atx-heading' && blockName !== 'setext-heading')
            continue;

        const block = node as IHeadingBlock;
        const head = block.children.head as Content | null;
        const text = muya.editor.contentTabs.headingSource(block, head?.text ?? '');

        const { cjkEmphasis, superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, highlightSyntax, inlineDiff } = muya.options;
        items.push({
            ...headingLabel(text, {
                profile: blockName,
                labels,
                options: { cjkEmphasis, superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, highlightSyntax, inlineDiff },
            }, seen),
            lvl: block.meta.level,
            slug: stableSlug(block),
        });
    }

    return items;
}
