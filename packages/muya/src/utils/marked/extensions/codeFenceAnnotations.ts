import type { MarkedExtension } from 'marked';
import type { ICodeLineRange } from '../../codeFenceAnnotations';
import { codeFenceLanguage, parseCodeFenceAnnotations } from '../../codeFenceAnnotations';
import { diagramTypeOfLang } from '../../diagram/fence';
import { escapeHTML, parseFenceLine } from '../../index';

// Prism spans can cross a logical line; close and reopen them inside each line's wrapper.
function renderAnnotatedLines(html: string, ranges: ICodeLineRange[]): string {
    const lines: string[] = [];
    const openSpans: string[] = [];
    let current = '';
    let rangeIndex = 0;
    const finishLine = () => {
        const line = lines.length + 1;
        while (rangeIndex < ranges.length && ranges[rangeIndex].end < line)
            rangeIndex++;
        const selected = ranges[rangeIndex]?.start <= line;
        lines.push(`<span class="mu-export-code-line${selected ? ' mu-export-code-highlight' : ''}">${current}${'</span>'.repeat(openSpans.length)}\n</span>`);
        current = openSpans.join('');
    };
    for (const part of html.split(/(<span\b[^>]*>|<\/span>|\n)/)) {
        if (part === '\n') {
            finishLine();
            continue;
        }
        if (part === '</span>')
            openSpans.pop();
        else if (part.startsWith('<span'))
            openSpans.push(part);
        current += part;
    }
    finishLine();
    return lines.join('');
}

export default function codeFenceAnnotationsExtension(): MarkedExtension {
    return {
        renderer: {
            code(token) {
                const info = parseFenceLine(token.raw)?.info.trim() ?? token.lang ?? '';
                const { title, ranges } = parseCodeFenceAnnotations(info);
                const language = codeFenceLanguage(info);
                if (!title && !ranges.length && (language || !info.startsWith('max-lines=')))
                    return false;
                if (token.codeBlockStyle === 'indented' || diagramTypeOfLang(language))
                    return false;

                const classAttribute = language ? ` class="language-${escapeHTML(language)}"` : '';
                const text = token.text.replace(/\n$/, '');
                const html = token.escaped ? text : escapeHTML(text);
                const code = ranges.length ? renderAnnotatedLines(html, ranges) : `${html}\n`;
                const block = `<pre><code${classAttribute}>${code}</code></pre>`;
                if (!title && !ranges.length)
                    return `${block}\n`;
                const caption = title ? `<figcaption>${escapeHTML(title)}</figcaption>\n` : '';
                return `<figure class="mu-export-code">${caption}${block}</figure>\n`;
            },
        },
    };
}
