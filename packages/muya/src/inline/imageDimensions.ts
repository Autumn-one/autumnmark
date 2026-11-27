import type { IEmbeddedImage, IEmbeddedImageEdit } from '../utils/embeddedImage';
import { replaceEmbeddedImage } from '../utils/embeddedImage';
import { imageToHtml, isFullImageWidth, isImageToken } from '../utils/image';
import { parseInline } from './parser/lexer';

export function embeddedPictureSize(raw: string, image: IEmbeddedImage, replace: (markup: string, expected: string) => void): IEmbeddedImageEdit['size'] {
    if (image.kind || !image.preview)
        return;
    const [token] = parseInline(replaceEmbeddedImage(raw, image, 'picture.png'));
    if (!isImageToken(token))
        return;
    const { width, height, ...attrs } = token.attrs;
    const pixels = (value?: string | null) => value && /^\d+$/.test(value) ? Number(value) : undefined;
    const fullWidth = isFullImageWidth(width);
    return {
        width: fullWidth ? '100%' : pixels(width),
        height: fullWidth ? undefined : pixels(height),
        apply(dimensions, expected) {
            const sized = { ...attrs, src: expected };
            if (dimensions.width !== undefined) {
                if (dimensions.width === '100%') {
                    Object.assign(sized, { width: '100%' });
                    replace(imageToHtml(sized), expected);
                    return;
                }
                if (!Number.isSafeInteger(dimensions.width) || dimensions.width < 1)
                    return;
                Object.assign(sized, { width: String(dimensions.width) });
            }
            if (dimensions.height !== undefined) {
                if (!Number.isSafeInteger(dimensions.height) || dimensions.height < 1)
                    return;
                Object.assign(sized, { height: String(dimensions.height) });
            }
            replace(imageToHtml(sized), expected);
        },
    };
}
