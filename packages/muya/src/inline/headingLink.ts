import { tokenEvents } from './model/traversal';
import { parseInline } from './parser/lexer';

/** Recognize a destination even while its title query contains spaces or its closing parenthesis is missing. */
export function headingLinkAt(text: string, caret: number) {
    const prefix = /\]\((<?)([^()<>\n#]*)#([^()<>\n#]*)$/.exec(text.slice(0, caret));
    if (!prefix || /^\s*(?:[a-z][\w+.-]*:|[/\\]{2})/i.test(prefix[2]))
        return;
    const from = prefix.index + 2;
    const suffix = /^[^\s<>()#]*/.exec(text.slice(caret))![0];
    const end = caret + suffix.length;
    const to = end + Number(prefix[1] === '<' && text[end] === '>');
    const tail = text.slice(to);
    const needsClose = !tail.trim();
    const probe = `${text.slice(0, from)}#target${needsClose ? ')' : ''}${tail}`;
    for (const { token, exiting } of tokenEvents(parseInline(probe))) {
        if (exiting || token.type !== 'link' || token.href !== '#target'
            || token.range.start + token.anchor.length + 3 !== from) {
            continue;
        }
        const linkStart = token.range.start;
        const linkEnd = token.range.end - probe.length + text.length;
        return {
            file: prefix[2],
            query: prefix[3],
            complete(href: string, title: string) {
                const label = token.anchor || title.replace(/[\\[\]\x60*_~<>]/g, '\\$&');
                const replacement = `[${label}](${href}${needsClose ? ')' : text.slice(to, linkEnd)}`;
                return { from: linkStart, to: linkEnd, text: replacement };
            },
        };
    }
}
