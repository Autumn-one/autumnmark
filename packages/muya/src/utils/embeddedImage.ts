/** UTF-16 source offsets include the owning image syntax so a single delete removes it. */
export interface IEmbeddedImage {
    start: number;
    end: number;
    src: string;
    srcStart: number;
    label: string;
    preview: boolean;
    kind?: 'video';
    name?: string;
}

export interface IEmbeddedImageEdit {
    kind?: 'video';
    src: string;
    name: string;
    readOnly: boolean;
    matches: (expected: string) => boolean;
    apply: (src: string | null, expected?: string) => void;
    undo: () => void;
}

const dataImage = /data:image\/[\w.+-]+(?:;[\w-]+=[\w.+-]+)*;base64,[a-z\d+/]+={0,2}/gi;
// A host may replace the Base64 payload with a private-use attachment reference while editing.
const videoData = /data:video\/[\w.+-]+(?:;[\w-]+=[\w.+-]+)*;base64,(?:[a-z\d+/]+={0,2}|\uE200[\uE300-\uE3FF]{16}\uE201)/gi;

export const embeddedImageSource = new WeakMap<Node, string>();

/** A native file drag can end in a click on the originating editor widget. */
export function bindEmbeddedImageEvents(node: HTMLElement, activate: (event: MouseEvent) => void) {
    let dragged = false;
    node.draggable = true;
    node.onpointerdown = () => {
        dragged = false;
    };
    node.ondragstart = (event) => {
        dragged = true;
        activate(event);
    };
    node.oncontextmenu = activate;
    node.onclick = (event) => {
        if (dragged && event.detail) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        activate(event);
    };
}

function imageLabel(src: string): string {
    return `${src.slice(0, src.indexOf(',') + 1)}…`;
}

export function abbreviateEmbeddedImages(text: string): string {
    return text.replace(dataImage, imageLabel).replace(videoData, imageLabel);
}

/** Preserve image attributes in rendered previews while abbreviating literal text. */
export function abbreviatePreviewText(root: Element) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node instanceof Text && /data:(?:image|video)\//i.test(node.data))
            node.data = abbreviateEmbeddedImages(node.data);
    }
}

function descriptionStart(line: string, end: number): number {
    let depth = 1;
    for (let i = end - 1; i > 0; i--) {
        const char = line[i];
        if (char !== '[' && char !== ']')
            continue;
        let before = i - 1;
        while (line[before] === '\\') before--;
        if ((i - before) % 2 === 0)
            continue;
        depth += char === '[' ? -1 : 1;
        if (!depth)
            return line[i - 1] === '!' ? i - 1 : -1;
    }
    return -1;
}

export function findEmbeddedImages(text: string): IEmbeddedImage[] {
    const images: IEmbeddedImage[] = [];
    for (const match of text.matchAll(dataImage)) {
        const src = match[0];
        const srcStart = match.index;
        let start = srcStart;
        let end = start + src.length;
        const previousEnd = images.at(-1)?.end ?? 0;
        if (start < previousEnd)
            continue;
        const gap = text.slice(previousEnd, start);
        const before = gap.slice(gap.lastIndexOf('\n') + 1);
        const open = /\]\([ \t]*(<?)$/.exec(before);
        let preview = false;
        if (open) {
            const after = text.slice(end);
            const close = /^(>?)(?:[ \t]+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^)\\\n])*\)))?[ \t]*\)/.exec(after);
            const imageStart = descriptionStart(before, open.index);
            if (imageStart >= 0 && close && !!open[1] === !!close[1]) {
                start -= before.length - imageStart;
                end += close[0].length;
                preview = true;
            }
        }
        else {
            const attribute = /\ssrc\s*=\s*(["']?)$/i.exec(before);
            const tag = attribute ? before.slice(0, attribute.index).match(/<img\b(?:[^<>"']|"[^"\n]*"|'[^'\n]*')*$/i) : null;
            if (attribute && tag?.index !== undefined) {
                const quote = attribute[1];
                const tail = text.slice(end + quote.length);
                const close = /^(?:[^<>"'\n]|"[^"\n]*"|'[^'\n]*')*>/.exec(tail);
                if (close && text.startsWith(quote, end)) {
                    start -= before.length - tag.index;
                    end += quote.length + close[0].length;
                    preview = true;
                }
            }
        }
        images.push({ start, end, srcStart, src, preview, label: imageLabel(src) });
    }
    return images;
}

function videoAttributes(tag: string) {
    let src = '';
    let offset = 0;
    let name = '';
    const attrs = /\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const attr of tag.matchAll(attrs)) {
        const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
        if (attr[1].toLowerCase() === 'src') {
            src = value;
            offset = attr.index + attr[0].lastIndexOf(value);
        }
        if (attr[1].toLowerCase() === 'title')
            name = value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    return { src, offset, name };
}

export function findEmbeddedMedia(text: string): IEmbeddedImage[] {
    const images = findEmbeddedImages(text);
    if (!/data:video\/|<video\b/i.test(text))
        return images;

    const videos: IEmbeddedImage[] = [];
    const tags = /(<video\b(?:[^<>"']|"[^"]*"|'[^']*')*>)(?:\s*(<source\b(?:[^<>"']|"[^"]*"|'[^']*')*>))?[^<]*<\/video\s*>/gi;
    for (const tag of text.matchAll(tags)) {
        const video = videoAttributes(tag[1]);
        const nested = !video.src && tag[2] ? videoAttributes(tag[2]) : null;
        const owner = nested ?? video;
        const { src } = owner;
        if (!src || (/^[a-z][\w+.-]*:/i.test(src) && !/^(?:data:video\/|https?:\/\/|file:\/\/|[a-z]:[\\/])/i.test(src)))
            continue;
        const srcStart = tag.index + owner.offset + (nested ? tag[0].indexOf(tag[2], tag[1].length) : 0);
        videos.push({ start: tag.index, end: tag.index + tag[0].length, src, srcStart, name: video.name, kind: 'video', label: video.name || '▶ Video', preview: true });
    }
    let index = 0;
    const bare: IEmbeddedImage[] = [];
    for (const match of text.matchAll(videoData)) {
        while (index < videos.length && videos[index].end <= match.index)
            index++;
        if (index < videos.length && videos[index].start <= match.index)
            continue;
        bare.push({ start: match.index, end: match.index + match[0].length, srcStart: match.index, src: match[0], kind: 'video', label: imageLabel(match[0]), preview: false });
    }
    const result: IEmbeddedImage[] = [];
    for (const media of [...images, ...videos, ...bare].sort((a, b) => a.start - b.start)) {
        if (media.start >= (result.at(-1)?.end ?? 0))
            result.push(media);
    }
    return result;
}

export function replaceEmbeddedImage(raw: string, image: IEmbeddedImage, src: string | null): string {
    if (src === null)
        return '';
    const relative = image.srcStart - image.start;
    return raw.slice(0, relative) + src + raw.slice(relative + image.src.length);
}
