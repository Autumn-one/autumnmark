import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type DiagramBlock from './index';
import { isHiddenByFold } from '../../folding';

export function embeddedDrawingFor(content: Nullable<Content>): DiagramBlock | undefined {
    if (!content?.muya.options.embeddedDrawing || !content.isInert)
        return;

    const drawing = content.closestBlock('diagram') as DiagramBlock | null;
    if (drawing?.meta.type !== 'excalidraw' || isHiddenByFold(drawing))
        return;

    const { contentTabs, foldBlocks } = content.muya.editor;
    if (!contentTabs.isHidden(content) && !foldBlocks.isHidden(content))
        return drawing;
}
