import { describe, expect, it } from 'vitest';
import { embeddedImageDestination, findDocumentImages, findLinkedDocumentMedia, findPastedImageSources } from '../pastedImageSources';

describe('pasted image destinations', () => {
    it('finds linked media in document order without including code, audio or embedded sources', () => {
        const markdown = [
            `![existing](data:image/png;base64,${'A'.repeat(2000)})`,
            '![leaf][art]',
            '[art]: a.png "Caption"',
            '<video title="clip"><source src=v.webm><source src="clip.mp4?a=1&amp;b=2"></video>',
            'Inline <video src="local.mp4"></video> and <video><source src="alt.mp4"></video>.',
            '<audio><source src="music.ogg"></audio>',
            '<video src="data:video/mp4;base64,AA=="></video>',
            '~~~html\n<video src="example.mp4"></video>\n~~~',
        ].join('\r\n\r\n');
        const media = findLinkedDocumentMedia(markdown);
        expect(media.map(({ kind, src }) => [kind, src])).toEqual([
            ['image', 'a.png'],
            ['video', 'v.webm'],
            ['video', 'clip.mp4?a=1&b=2'],
            ['video', 'local.mp4'],
            ['video', 'alt.mp4'],
        ]);
        expect(media.map(item => markdown.slice(item.start, item.end))).toEqual(['[art]', 'v.webm', 'clip.mp4?a=1&amp;b=2', 'local.mp4', 'alt.mp4']);
        expect(embeddedImageDestination(media[1], 'data:video/webm;base64,AA==')).toBe('"data:video/webm;base64,AA=="');
    });

    it('resolves repeated and shortcut references without changing a shared link definition', () => {
        const markdown = '![picture][a] ![A][] ![A] [original][a]\n\n[A]: <my pic.png> "Caption"';
        const images = findDocumentImages(markdown);
        expect(images.map(image => image.src)).toEqual(Array.from({ length: 3 }).fill('my pic.png'));
        let output = markdown;
        for (const image of images.reverse())
            output = output.slice(0, image.start) + embeddedImageDestination(image, 'data:image/png;base64,AA==') + output.slice(image.end);
        expect(output).toContain('![A](data:image/png;base64,AA== "Caption") [original][a]');
        expect(output).toContain('[A]: <my pic.png> "Caption"');
    });

    it('retains UTF-16 destination offsets after large embedded images and skips code samples', () => {
        const markdown = `![🍂](data:image/png;base64,${'A'.repeat(100_000)})\n\n\`![code](example.png)\`\n\n<img src=leaf.png>`;
        const images = findDocumentImages(markdown);
        expect(images).toHaveLength(2);
        expect(markdown.slice(images[1].start, images[1].end)).toBe('leaf.png');
    });

    it('preserves Markdown delimiters and HTML attributes and decodes sources for loading', () => {
        const markdown = [
            '[![a [map]](<a map(1).png> "a map(1).png")](https://example.org)',
            '<img ALT=\'src=wrong\' SRC = \'https://example.org/img?a=1&amp;b=2\' width=20>',
            '<IMG src=relative.png>',
        ].join('\n\n');
        const images = findPastedImageSources(markdown);
        expect(images.map(image => image.src)).toEqual(['a map(1).png', 'https://example.org/img?a=1&b=2', 'relative.png']);
        let output = markdown;
        for (const image of images.reverse()) {
            const replacement = embeddedImageDestination(image, 'data:image/png;base64,AA==');
            output = output.slice(0, image.start) + replacement + output.slice(image.end);
        }
        expect(output).toEqual([
            '[![a [map]](<data:image/png;base64,AA==> "a map(1).png")](https://example.org)',
            '<img ALT=\'src=wrong\' SRC = \'data:image/png;base64,AA==\' width=20>',
            '<IMG src="data:image/png;base64,AA==">',
        ].join('\n\n'));
    });

    it('skips code, comments, ordinary links and already embedded images', () => {
        expect(findPastedImageSources([
            '[link](local.png) `![example](local.png)`',
            '~~~html\n<img src="example.png">\n~~~',
            '    ![example](local.png)',
            '<!-- <img src="comment.png"> -->',
            '![embedded](data:image/png;base64,AA==)',
        ].join('\n\n'))).toEqual([]);
    });
});
