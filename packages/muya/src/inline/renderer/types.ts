import type { h, VNode } from 'snabbdom';
import type { PagePreviews } from '../../editor/pagePreviews';

import type { ITokenRange, Labels, Token } from '../model/types';

export type H = typeof h;

export interface ISyntaxRenderOptions {
    h: H;
    cursor: IInlineCursor;
    block: IRenderBlock;
    token: Token;
    outerClass?: string;
}

export interface IContainerRenderOptions extends ISyntaxRenderOptions {
    childNodes: (tokens: readonly Token[]) => (VNode | string)[];
}

/** Structural inputs: rendering cannot mutate an editor block or selection. */
export interface IRenderBlock {
    readonly text: string;
    readonly blockName: string;
    readonly domNode?: HTMLElement | null | void;
    readonly previewScope?: PagePreviews;
}

export interface IInlineCursor {
    block?: object;
    anchor?: { offset: number };
    focus?: { offset: number };
    start?: { offset: number };
    end?: { offset: number };
}

export interface IInlineEnvironment {
    readonly root: HTMLElement;
    readonly previewScope?: PagePreviews;
    readonly readOnly: boolean;
    readonly softNewlineAsSpace: boolean;
    readonly references: Labels;
    readonly documentDirname?: string;
    readonly documentPathname?: string;
    readonly resolveImagePreview?: (src: string, documentPathname?: string) => { key: string; load: (signal?: AbortSignal) => Promise<string> } | undefined;
    readonly selectedImage: { block: object; range: ITokenRange } | null;
    readonly translate: (text: string) => string;
}
