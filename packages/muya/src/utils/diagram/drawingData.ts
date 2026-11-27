import type { ImageToken, Token } from '../../inline/model/types';

export const INLINE_DRAWING_DATA_PREFIX = 'data:application/x-excalidraw;base64,';

export function isInlineDrawingSource(src: string): boolean {
    return src.startsWith(INLINE_DRAWING_DATA_PREFIX);
}

export function isLinkedDrawingSource(src: string): boolean {
    if (!src || /^data:/i.test(src))
        return false;
    const path = src.split(/[?#]/, 1)[0];
    try {
        return /\.excalidraw$/i.test(decodeURIComponent(path));
    }
    catch {
        return /\.excalidraw$/i.test(path);
    }
}

export function isDrawingImageSource(src: string): boolean {
    return isInlineDrawingSource(src) || isLinkedDrawingSource(src);
}

export function isInlineDrawingImage(token: Token): token is ImageToken {
    return token.type === 'image' && isInlineDrawingSource(token.attrs.src);
}

export function isLinkedDrawingImage(token: Token): token is ImageToken {
    return token.type === 'image' && isLinkedDrawingSource(token.attrs.src);
}

export function isDrawingImageToken(token: Token): token is ImageToken {
    return isInlineDrawingImage(token) || isLinkedDrawingImage(token);
}

export function encodeInlineDrawing(source: string): string {
    const bytes = new TextEncoder().encode(source);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    return INLINE_DRAWING_DATA_PREFIX + btoa(chunks.join(''));
}

export function decodeInlineDrawing(src: string): string | undefined {
    if (!isInlineDrawingSource(src))
        return;
    try {
        const bytes = Uint8Array.from(atob(src.slice(INLINE_DRAWING_DATA_PREFIX.length)), char => char.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return undefined;
    }
}
