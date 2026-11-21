// Prism tokens may cross newlines. Split their presentation into rows after
// highlighting, keeping the literal newlines for selection and source offsets.
export function indentReadingLines(html: string): string {
    const source = document.createElement('div');
    source.innerHTML = html;
    const result = document.createElement('div');
    let row = document.createElement('span');
    const copies = new Map<Node, HTMLElement>();

    function parentInRow(node: HTMLElement): HTMLElement {
        if (node === source)
            return row;
        let copy = copies.get(node);
        if (!copy) {
            copy = node.cloneNode(false) as HTMLElement;
            parentInRow(node.parentElement!).append(copy);
            copies.set(node, copy);
        }
        return copy;
    }

    function finishRow(): void {
        const indent = /^[\t ]*/.exec(row.textContent ?? '')![0];
        let columns = 0;
        for (const char of indent)
            columns += char === '\t' ? 4 - columns % 4 : 1;
        row.className = 'mu-reading-code-line';
        if (columns)
            row.style.setProperty('--mu-line-indent', `${columns}ch`);
        result.append(row);
        row = document.createElement('span');
        copies.clear();
    }

    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const part of (node.nodeValue ?? '').match(/[^\n]*\n|[^\n]+$/g) ?? []) {
            parentInRow(node.parentElement!).append(part);
            if (part.endsWith('\n'))
                finishRow();
        }
    }
    if (row.hasChildNodes())
        finishRow();
    return result.innerHTML;
}
