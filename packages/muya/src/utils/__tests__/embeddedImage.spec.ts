import { describe, expect, it } from 'vitest';
import { findEmbeddedImages } from '../embeddedImage';

const src = 'data:image/png;base64,iVBORw0KGgo=';

describe('embedded image source ranges', () => {
    it.each([
        `![map](${src})`,
        `![a [nested] b](<${src}> "a title")`,
        `![a \\] b](${src})`,
        `<img alt="a > b" src='${src}' width="25" />`,
    ])('includes the full image in an atomic range', (raw) => {
        const text = `前 ${raw} 後`;
        const [image] = findEmbeddedImages(text);
        expect(text.slice(image.start, image.end)).toBe(raw);
        expect(image.preview).toBe(true);
    });

    it('preserves surrounding links, reference labels and neighboring images', () => {
        const raw = `![](${src})`;
        const text = `[${raw}](url)${raw}\n\n[ref]: ${src}`;
        expect(findEmbeddedImages(text).map(i => text.slice(i.start, i.end))).toEqual([raw, raw, src]);
    });

    it('leaves ordinary images, text and non-image data URLs editable', () => {
        expect(findEmbeddedImages('![map](map.png) data:text/plain;base64,YQ==')).toEqual([]);
    });
});
