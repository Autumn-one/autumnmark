import { describe, expect, it } from 'vitest';
import { findEmbeddedImages, findEmbeddedMedia, replaceEmbeddedImage } from '../embeddedImage';

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

    it.each([
        '<video controls title="A &amp; B" src="SOURCE"></video>',
        '<video controls title="A &amp; B">\n<source src="SOURCE" type="video/webm">Fallback</video>',
    ])('keeps a video and its source range together alongside an image', (template) => {
        const video = 'data:video/webm;base64,AQID';
        const raw = template.replace('SOURCE', video);
        const text = `![map](${src}) ${raw} tail`;
        const media = findEmbeddedMedia(text);
        expect(media).toHaveLength(2);
        expect(media[1]).toMatchObject({ kind: 'video', name: 'A & B', src: video });
        expect(text.slice(media[1].start, media[1].end)).toBe(raw);
        expect(replaceEmbeddedImage(raw, media[1], 'assets/new.webm')).toBe(template.replace('SOURCE', 'assets/new.webm'));
    });

    it('leaves ordinary images, text and non-image data URLs editable', () => {
        expect(findEmbeddedImages('![map](map.png) data:text/plain;base64,YQ==')).toEqual([]);
    });
});
