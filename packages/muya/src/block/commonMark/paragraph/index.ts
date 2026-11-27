import type { Doc } from 'ot-json1';
import type { Muya } from '../../../muya';
import type { IParagraphMeta, IParagraphState, TDrawingWidth } from '../../../state/types';
import type ParagraphContent from '../../content/paragraphContent';
import { CLASS_NAMES } from '../../../config';
import { deepClone, mixins } from '../../../utils';
import {
    applyDrawingWidth,
    mergeDrawingWidths,
    normalizeDrawingWidths,
    remapDrawingWidthsBySource,
    splitDrawingWidths,
} from '../../../utils/drawingLayout';
import Parent from '../../base/parent';
import LeafQueryBlock from '../../mixins/leafQueryBlock';
import { ScrollPage } from '../../scrollPage';

function metaAsDoc(meta: IParagraphMeta): Doc {
    const widths: { [key: string]: Doc } = {};
    if (meta.drawingWidths) {
        for (const [key, value] of Object.entries(meta.drawingWidths))
            widths[key] = value;
    }
    return { drawingWidths: widths };
}

function normalizeParagraphMeta(meta?: IParagraphMeta): IParagraphMeta | undefined {
    const drawingWidths = normalizeDrawingWidths(meta?.drawingWidths);
    return drawingWidths ? { drawingWidths } : undefined;
}

@mixins(LeafQueryBlock)
class Paragraph extends Parent {
    public meta?: IParagraphMeta;
    private _explicitMetaDepth = 0;

    static override blockName = 'paragraph';

    static create(muya: Muya, state: IParagraphState) {
        const paragraph = new Paragraph(muya, state.meta);

        paragraph.append(
            ScrollPage.loadBlock('paragraph.content').create(muya, state.text),
        );
        paragraph.applyDrawingWidths();

        return paragraph;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, meta?: IParagraphMeta) {
        super(muya);
        this.tagName = 'p';
        this.meta = normalizeParagraphMeta(meta);
        this.classList = [CLASS_NAMES.MU_PARAGRAPH];
        this.createDomNode();
    }

    drawingWidthAt(index: number): TDrawingWidth | undefined {
        return this.meta?.drawingWidths?.[String(index)];
    }

    applyDrawingWidths(): void {
        const contentDom = this.firstChild?.domNode;
        if (!contentDom)
            return;
        const drawings = contentDom.querySelectorAll<HTMLElement>('.mu-inline-drawing, .mu-linked-drawing');
        drawings.forEach((drawing, index) => {
            applyDrawingWidth(drawing, this.drawingWidthAt(index + 1));
        });
    }

    withExplicitDrawingMeta<T>(action: () => T): T {
        this._explicitMetaDepth++;
        try {
            return action();
        }
        finally {
            this._explicitMetaDepth--;
        }
    }

    private _writeMetaInTransaction(after: IParagraphMeta | undefined): void {
        const before = this.meta ? deepClone(this.meta) : undefined;
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null))
            return;
        const metaPath = [...this.path, 'meta'];
        this.meta = after;
        if (!before && after)
            this.transactions.insertValueOperation(metaPath, metaAsDoc(after));
        else if (before && after)
            this.transactions.replaceOperation(metaPath, metaAsDoc(before), metaAsDoc(after));
        else if (before && !after)
            this.transactions.removeOperation(metaPath);
    }

    setDrawingWidth(index: number, width: TDrawingWidth | undefined): void {
        if (!this.muya.canMutate || !this.muya.isBlockInDocument(this) || !Number.isSafeInteger(index) || index < 1)
            return;
        const before = this.meta ? deepClone(this.meta) : undefined;
        const nextMap: Record<string, TDrawingWidth> = { ...this.meta?.drawingWidths };
        if (width === undefined)
            delete nextMap[String(index)];
        else
            nextMap[String(index)] = width;
        const after = normalizeParagraphMeta({ drawingWidths: nextMap });
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) {
            this.applyDrawingWidths();
            return;
        }

        this.muya.editor.history.cutoff();
        this.muya.transact(() => {
            this._writeMetaInTransaction(after);
            this.applyDrawingWidths();
            // Pointer-driven resizes commit while the text caret can sit far offscreen.
            this.muya.editor.selection.preventScrollOnNextNotification();
        });
        this.muya.editor.history.cutoff();
    }

    syncDrawingLayout(state: unknown): void {
        const meta = state && typeof state === 'object' && 'meta' in state
            ? (state as IParagraphState).meta
            : undefined;
        this.meta = normalizeParagraphMeta(meta);
        this.applyDrawingWidths();
    }

    setExplicitDrawingWidths(widths: Record<string, TDrawingWidth> | undefined): void {
        const after = normalizeParagraphMeta(widths ? { drawingWidths: widths } : undefined);
        this._writeMetaInTransaction(after);
    }

    remapDrawingMetaOnTextChange(oldText: string, newText: string): void {
        if (this._explicitMetaDepth > 0 || !this.meta?.drawingWidths || !this.muya.canMutate || !this.muya.isBlockInDocument(this))
            return;
        const remapped = remapDrawingWidthsBySource(this.meta.drawingWidths, oldText, newText);
        this._writeMetaInTransaction(remapped ? { drawingWidths: remapped } : undefined);
    }

    splitDrawingMeta(originalText: string, headText: string, tailText: string): IParagraphMeta | undefined {
        if (!this.meta?.drawingWidths)
            return;
        const { head, tail } = splitDrawingWidths(this.meta.drawingWidths, originalText, headText, tailText);
        this._writeMetaInTransaction(head ? { drawingWidths: head } : undefined);
        return tail ? { drawingWidths: tail } : undefined;
    }

    mergeDrawingMeta(options: {
        oldText: string;
        head: string;
        inserted: string;
        tail: string;
        incomingMeta?: IParagraphMeta;
        detachedTail?: string;
    }): IParagraphMeta | undefined {
        if (!this.meta?.drawingWidths && !options.incomingMeta?.drawingWidths)
            return;
        const { merged, detachedTail } = mergeDrawingWidths({
            existingWidths: this.meta?.drawingWidths,
            oldText: options.oldText,
            head: options.head,
            inserted: options.inserted,
            tail: options.tail,
            incomingWidths: options.incomingMeta?.drawingWidths,
            detachedTail: options.detachedTail,
        });
        this._writeMetaInTransaction(merged ? { drawingWidths: merged } : undefined);
        return detachedTail ? { drawingWidths: detachedTail } : undefined;
    }

    override getState(): IParagraphState {
        return {
            name: 'paragraph',
            ...(this.meta ? { meta: deepClone(this.meta) } : {}),
            text: (this.children.head as ParagraphContent).text,
        };
    }
}

export default Paragraph;
