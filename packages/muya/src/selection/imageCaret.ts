const atoms = '.mu-inline-image, .mu-embedded-image';

export interface IImageCaret {
    atom: HTMLElement;
    edge: 'start' | 'end';
}

function sibling(node: Node, root: Node, forward: boolean): Node | null {
    for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
        const next = forward ? current.nextSibling : current.previousSibling;
        if (next)
            return next;
    }
    return null;
}

export function imageBesideCaret(root: Node, node: Node, offset: number, forward: boolean): HTMLElement | null {
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
export function imageCaret(root: HTMLElement): IImageCaret | null {
    const selection = root.ownerDocument.getSelection();
    const node = selection?.anchorNode;
    if (!selection?.isCollapsed || !node || !root.contains(node))
        return null;
    const offset = selection.anchorOffset;
    const inside = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(atoms);
    const after = inside ? offset > 0 : false;
    const before = inside ?? imageBesideCaret(root, node, offset, true);
    const atom = before ?? imageBesideCaret(root, node, offset, false);
    if (!atom)
        return null;
    return {
        atom,
        edge: after || !before ? 'end' : 'start',
    };
}

export function paintImageCaret({ atom, edge }: IImageCaret): HTMLElement {
    let element = atom.querySelector<HTMLElement>('.mu-image-container') ?? atom;
    if (atom.matches('.mu-inline-image, .mu-embedded-picture') && getComputedStyle(atom).display.startsWith('inline')) {
        // An empty inline box shares the text baseline even when a taller neighbor sets the line height.
        element = atom.ownerDocument.createElement('span');
        element.className = 'mu-inline-image-caret';
        element.setAttribute('aria-hidden', 'true');
        if (edge === 'start')
            atom.before(element);
        else
            atom.after(element);
    }
    element.dataset.muImageCaret = edge;
    return element;
}

export function clearImageCaret(element: HTMLElement) {
    // Native input can land inside the marker before the editor rebuilds the line.
    if (element.classList.contains('mu-inline-image-caret'))
        element.replaceWith(...element.childNodes);
    else
        delete element.dataset.muImageCaret;
}
