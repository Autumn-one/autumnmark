/** UTF-16 source offsets include the owning image syntax so a single delete removes it. */
export interface IEmbeddedImage {
    start: number;
    end: number;
    src: string;
    srcStart: number;
    label: string;
    preview: boolean;
}

export interface IEmbeddedImageEdit {
    src: string;
    apply: (src: string | null) => void;
}

const dataImage = /data:image\/[\w.+-]+(?:;[\w-]+=[\w.+-]+)*;base64,[a-z\d+/]+={0,2}/gi;

export const embeddedImageSource = new WeakMap<Node, string>();

function imageLabel(src: string): string {
    return `${src.slice(0, src.indexOf(',') + 1)}…`;
}

export function abbreviateEmbeddedImages(text: string): string {
    return text.replace(dataImage, imageLabel);
}

/** Preserve image attributes in rendered previews while abbreviating literal text. */
export function abbreviatePreviewText(root: Element) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node instanceof Text && /data:image\//i.test(node.data))
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

export function replaceEmbeddedImage(raw: string, image: IEmbeddedImage, src: string | null): string {
    if (src === null)
        return '';
    const relative = image.srcStart - image.start;
    return raw.slice(0, relative) + src + raw.slice(relative + image.src.length);
}
