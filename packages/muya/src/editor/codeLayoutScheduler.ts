import type CodeBlockContent from '../block/content/codeBlockContent';
import { lineHighlightBackground, measureLineTops, repositionLineNumberSpans } from '../utils/codeBlockLineNumbers';

interface IMeasuredCodeBlock {
    code: HTMLElement;
    content: HTMLElement;
    wrapper: HTMLElement | null;
    ranges: { start: number; end: number }[];
    tops: number[];
    wrapperTop: number;
    clientHeight: number;
    scrollTop: number;
    scrollHeight: number;
}

/**
 * Coalesces code-block gutter and highlight measurements across the document into
 * one read-all / write-all animation frame to prevent N-block layout thrashing.
 */
export class CodeLayoutScheduler {
    private _dirty = new Set<CodeBlockContent>();
    private _frame: number | null = null;

    schedule(block: CodeBlockContent): void {
        if (!block.domNode?.isConnected)
            return;
        this._dirty.add(block);
        if (this._frame !== null)
            return;
        if (typeof requestAnimationFrame !== 'function') {
            this.flush();
            return;
        }
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.flush();
        });
    }

    unschedule(block: CodeBlockContent): void {
        this._dirty.delete(block);
    }

    flush(): void {
        if (this._dirty.size === 0)
            return;
        const pending = [...this._dirty];
        this._dirty.clear();

        // Phase 1: read-all geometry before any style mutations.
        const measured: IMeasuredCodeBlock[] = [];
        for (const block of pending) {
            const parent = block.parent;
            const code = parent?.domNode;
            const owner = parent?.parent;
            const content = block.domNode;
            if (!parent || !code?.isConnected || !content?.isConnected || owner?.blockName !== 'code-block') {
                block.disconnectLayoutObserver();
                continue;
            }
            const wrapper = parent.lineNumbersWrapper;
            const ranges = owner.annotations.ranges;
            if (!wrapper && !ranges.length)
                continue;

            const tops = measureLineTops(content);
            let wrapperTop = 0;
            let clientHeight = 0;
            let scrollTop = 0;
            if (wrapper) {
                const frame = owner.domNode!;
                wrapperTop = code.getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop;
                clientHeight = code.clientHeight;
                scrollTop = code.scrollTop;
            }
            measured.push({
                code,
                content,
                wrapper,
                ranges,
                tops,
                wrapperTop,
                clientHeight,
                scrollTop,
                scrollHeight: code.scrollHeight,
            });
        }

        // Phase 2: write-all styles without interleaving layout reads.
        for (const item of measured) {
            if (item.wrapper) {
                item.wrapper.style.top = `${item.wrapperTop}px`;
                item.wrapper.style.setProperty('--mu-gutter-height', `${item.clientHeight}px`);
                repositionLineNumberSpans(item.wrapper, item.content, item.tops);
                item.wrapper.scrollTop = item.scrollTop;
            }
            item.code.style.backgroundImage = lineHighlightBackground(item.tops, item.scrollHeight, item.ranges);
        }
    }

    clear(): void {
        this._dirty.clear();
        if (this._frame !== null) {
            cancelAnimationFrame(this._frame);
            this._frame = null;
        }
    }

    dispose(): void {
        this.clear();
    }
}
