import type CodeBlock from './index';

interface IResizeGesture {
    pointerId: number;
    startY: number;
    startLines: number;
    lineHeight: number;
    expanded: boolean;
    lines: number;
}

export function createCodeResizeHandle(block: CodeBlock, viewport: HTMLElement): HTMLButtonElement {
    const { muya } = block;
    const handle = viewport.ownerDocument.createElement('button');
    handle.type = 'button';
    handle.contentEditable = 'false';
    handle.className = 'mu-code-resize mu-copy-remove mu-output-remove';
    handle.title = muya.i18n.t('Drag to resize, double-click to follow compact mode');
    handle.setAttribute('aria-label', muya.i18n.t('Resize code block'));
    let drag: IResizeGesture | undefined;

    const lineHeight = () => Number.parseFloat(getComputedStyle(viewport.firstElementChild!).lineHeight);
    const visibleLines = (height: number) => Math.max(1, Math.round(viewport.clientHeight / height));
    const preview = (event: PointerEvent) => {
        if (!drag || drag.pointerId !== event.pointerId || !muya.canMutate)
            return;
        const lines = Math.max(1, drag.startLines + Math.round((event.clientY - drag.startY) / drag.lineHeight));
        if (lines === drag.lines)
            return;
        drag.lines = lines;
        handle.dataset.lines = muya.i18n.t('Rows: {n}').replace('{n}', String(lines));
        viewport.classList.remove('mu-compact-expanded');
        muya.editor.compactBlocks.setCodeLimit(viewport, lines);
    };
    const finish = (event: PointerEvent, commit: boolean) => {
        if (!drag || drag.pointerId !== event.pointerId)
            return;
        const { lines, startLines, expanded } = drag;
        drag = undefined;
        delete handle.dataset.lines;
        if (handle.hasPointerCapture(event.pointerId))
            handle.releasePointerCapture(event.pointerId);
        if (commit && muya.canMutate && lines !== startLines) {
            block.setMaxLines(lines);
        }
        else {
            viewport.classList.toggle('mu-compact-expanded', expanded);
            muya.editor.compactBlocks.setCodeLimit(viewport, block.annotations.maxLines);
        }
    };

    handle.addEventListener('pointerdown', (event) => {
        if (!muya.canMutate || drag || event.button !== 0 || !event.isPrimary)
            return;
        event.preventDefault();
        const height = lineHeight();
        const lines = visibleLines(height);
        drag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startLines: lines,
            lineHeight: height,
            expanded: viewport.classList.contains('mu-compact-expanded'),
            lines,
        };
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', preview);
    handle.addEventListener('pointerup', (event) => {
        preview(event);
        finish(event, true);
    });
    handle.addEventListener('pointercancel', event => finish(event, false));
    handle.addEventListener('lostpointercapture', event => finish(event, false));
    handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        block.setMaxLines(undefined);
    });
    handle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.detail === 0)
            block.setMaxLines(undefined);
    });
    handle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ')
            event.stopPropagation();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const delta = event.key === 'ArrowUp' ? -1 : 1;
            block.setMaxLines(Math.max(1, visibleLines(lineHeight()) + delta));
        }
    });
    return handle;
}
