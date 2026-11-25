import type { IEmbeddedImage, IEmbeddedImageEdit } from '../utils/embeddedImage';
import { replaceEmbeddedImage } from '../utils/embeddedImage';
import { imageToHtml, isImageToken } from '../utils/image';
import { parseInline } from './parser/lexer';

export function embeddedPictureSize(raw: string, image: IEmbeddedImage, replace: (markup: string, expected: string) => void): IEmbeddedImageEdit['size'] {
    if (image.kind || !image.preview)
        return;
    const [token] = parseInline(replaceEmbeddedImage(raw, image, 'picture.png'));
    if (!isImageToken(token))
        return;
    const { width, height, ...attrs } = token.attrs;
    const pixels = (value?: string | null) => value && /^\d+$/.test(value) ? Number(value) : undefined;
    return {
        width: pixels(width),
        height: pixels(height),
        apply(dimensions, expected) {
            const sized = { ...attrs, src: expected };
            for (const key of ['width', 'height'] as const) {
                const value = dimensions[key];
                if (value === undefined)
                    continue;
                if (!Number.isSafeInteger(value) || value < 1)
                    return;
                Object.assign(sized, { [key]: String(value) });
            }
            replace(imageToHtml(sized), expected);
        },
    };
}
