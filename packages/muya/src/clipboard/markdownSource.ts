import { PREVIEW_DOMPURIFY_CONFIG } from '../config';
import HtmlToMarkdown from '../state/htmlToMarkdown';
import { sanitize } from '../utils';
import { standaloneImageSource } from '../utils/paste';
import { findPastedImageSources } from './pastedImageSources';

// Rich HTML cannot retain source-only markers such as `#.` or non-sequential
// numbers. The wrapper identifies Markdown in the accompanying text/plain slot.
export function withMarkdownSource(html: string): string {
    return `<div data-marktext-markdown="1">${html}</div>`;
}

export function hasMarkdownSource(html: string): boolean {
    if (!html.includes('data-marktext-markdown'))
        return false;
    const { body } = new DOMParser().parseFromString(html, 'text/html');

    return body.children.length === 1 && body.firstElementChild!.matches('div[data-marktext-markdown="1"]');
}

export function imageDocumentFlavor(text: string, html: string, bitmap: File | null) {
    if (findPastedImageSources(text).length)
        return 'markdown';
    if (!/<img\b/i.test(html) || (bitmap && standaloneImageSource(html)))
        return;
    return text && hasMarkdownSource(html) ? 'markdown' : 'html';
}

export function imageDocumentMarkdown(text: string, html: string, bitmap: File | null, bulletListMarker: string) {
    const flavor = imageDocumentFlavor(text, html, bitmap);
    if (flavor === 'markdown')
        return text;
    if (flavor === 'html')
        return new HtmlToMarkdown({ bulletListMarker }).generate(sanitize(html, PREVIEW_DOMPURIFY_CONFIG, false) as string);
}
