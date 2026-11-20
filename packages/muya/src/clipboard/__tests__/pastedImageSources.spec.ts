import { describe, expect, it } from 'vitest';
import { embeddedImageDestination, findPastedImageSources } from '../pastedImageSources';

describe('pasted image destinations', () => {
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
