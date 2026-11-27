import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type { IParagraphState, TState } from '../state/types';
import type { Nullable } from '../types';
import { splitDrawingWidths } from '../utils/drawingLayout';

interface IPasteCursor {
    startOffset: number;
    endOffset: number;
}

// Merge the first pasted paragraph into a heading and return the remaining states.
// Return the original array when the heading merge does not apply.
export function mergePasteIntoHeading(
    anchorBlock: Content,
    wrapperBlock: Nullable<Pick<Parent, 'blockName'>>,
    states: TState[],
    cursor: IPasteCursor,
): TState[] {
    if (states.length === 0)
        return states;

    const isAtx = wrapperBlock?.blockName === 'atx-heading';
    const isSetext = wrapperBlock?.blockName === 'setext-heading';
    if (!isAtx && !isSetext)
        return states;

    const first = states[0];
    if (first.name !== 'paragraph')
        return states;

    const original = anchorBlock.text;
    const head = original.substring(0, cursor.startOffset);
    const remaining = states.slice(1);

    // The anchor's tail is NOT kept here — the caller sews it onto the last
    // pasted block instead.
    if (isSetext) {
        // Setext headings allow soft breaks; ATX headings must stay on one line.
        anchorBlock.text = head + first.text;
    }
    else {
        // An atx heading is a single line: only the first soft-line stays; the
        // following lines become a paragraph block below it.
        const [firstLine, ...restLines] = first.text.split('\n');
        anchorBlock.text = head + firstLine;
        if (restLines.length > 0) {
            const restText = restLines.join('\n');
            const tailWidths = splitDrawingWidths(first.meta?.drawingWidths, first.text, firstLine, restText).tail;
            const paragraphState: IParagraphState = {
                name: 'paragraph',
                ...(tailWidths ? { meta: { drawingWidths: tailWidths } } : {}),
                text: restText,
            };
            remaining.unshift(paragraphState);
        }
    }
    anchorBlock.update();

    return remaining;
}
