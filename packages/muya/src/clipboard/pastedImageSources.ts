import type { DefaultTreeAdapterTypes } from 'parse5';
import { parse, postprocess, preprocess } from 'micromark';
import { parseFragment } from 'parse5';
import { decodeMarkdownString } from '../utils/markdownEscape';

export interface IPastedImageSource {
    src: string;
    start: number;
    end: number;
    unquotedAttribute?: boolean;
}

export function embeddedImageDestination(image: IPastedImageSource, dataUrl: string) {
    // Base64 padding is not valid inside an unquoted CommonMark HTML attribute.
    return image.unquotedAttribute ? `"${dataUrl}"` : dataUrl;
}

function htmlImages(html: string, offset: number, images: IPastedImageSource[]) {
    if (!/<img\b/i.test(html))
        return;
    function visit(node: DefaultTreeAdapterTypes.Node) {
        if ('tagName' in node && node.tagName === 'img') {
            const attr = node.sourceCodeLocation?.attrs?.src;
            const src = node.attrs.find(attr => attr.name === 'src')?.value;
            if (!attr || !src)
                return;
            const raw = html.slice(attr.startOffset, attr.endOffset);
            const prefix = /^src\s*=\s*(["']?)/i.exec(raw);
            if (prefix)
                images.push({ src, start: offset + attr.startOffset + prefix[0].length, end: offset + attr.endOffset - prefix[1].length, unquotedAttribute: !prefix[1] });
        }
        else if ('childNodes' in node) {
            for (const child of node.childNodes)
                visit(child);
        }
    }
    visit(parseFragment(html, { sourceCodeLocationInfo: true }));
}

/** Source offsets let editors replace only the destination, retaining attribute spelling and Markdown delimiters. */
export function findPastedImageSources(markdown: string): IPastedImageSource[] {
    if (!/!\[|<img\b/i.test(markdown))
        return [];
    const images: IPastedImageSource[] = [];
    const owners: string[] = [];
    const events = postprocess(parse().document().write(preprocess()(markdown, undefined, true)));
    for (const [event, token] of events) {
        const { type, start, end } = token;
        if (type === 'image' || type === 'link') {
            if (event === 'enter')
                owners.push(type);
            else
                owners.pop();
        }
        else if (event === 'enter') {
            if (type === 'resourceDestinationString' && owners.at(-1) === 'image') {
                const src = decodeMarkdownString(markdown.slice(start.offset, end.offset));
                images.push({ src, start: start.offset, end: end.offset });
            }
            else if (type === 'htmlText' || type === 'htmlFlow') {
                htmlImages(markdown.slice(start.offset, end.offset), start.offset, images);
            }
        }
    }
    return images.filter(({ src }) => src && !src.startsWith('#')
        && (!/^[a-z][\w+.-]*:/i.test(src) || /^(?:https?:\/\/|file:\/\/|[a-z]:[\\/])/i.test(src)));
}
