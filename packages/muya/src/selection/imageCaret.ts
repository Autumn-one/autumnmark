const atoms = '.mu-inline-image, .mu-embedded-image';

function sibling(node: Node, root: Node, forward: boolean): Node | null {
    for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
        const next = forward ? current.nextSibling : current.previousSibling;
        if (next)
            return next;
    }
    return null;
}

function beside(root: Node, node: Node, offset: number, forward: boolean): HTMLElement | null {
    if (node instanceof Text && offset !== (forward ? node.length : 0))
        return null;
    let next: Node | null = node.childNodes[forward ? offset : offset - 1] ?? sibling(node, root, forward);
    while (next) {
        if (next instanceof HTMLElement && next.matches(atoms))
            return next;
        if (next instanceof Text && next.length)
            return null;
        next = (forward ? next.firstChild : next.lastChild) ?? sibling(next, root, forward);
    }
    return null;
}

/** Chromium can accept text beside a noneditable image without painting its native caret. */
export function imageCaret(root: HTMLElement) {
    const selection = root.ownerDocument.getSelection();
    const node = selection?.anchorNode;
    if (!selection?.isCollapsed || !node || !root.contains(node))
        return null;
    const offset = selection.anchorOffset;
    const inside = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(atoms);
    const after = inside ? offset > 0 : false;
    const before = inside ?? beside(root, node, offset, true);
    const atom = before ?? beside(root, node, offset, false);
    if (!atom)
        return null;
    return {
        element: atom.querySelector<HTMLElement>('.mu-image-container') ?? atom,
        edge: after || !before ? 'end' : 'start',
    };
}
