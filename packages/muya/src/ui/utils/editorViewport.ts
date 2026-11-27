import type { Middleware } from '@floating-ui/dom';
import { findScrollContainer } from '../../utils/dom';

export const EDITOR_VIEWPORT_MIDDLEWARE_NAME = 'constrainToEditorViewport';

export interface IEditorViewportConstraintData {
    clipped: boolean;
}

// Absorbs IEEE-754 subpixel drift (e.g. 125% DPI scaling) without allowing a
// 1-device-pixel overlap into surrounding chrome.
const SUBPIXEL_EPSILON = 0.01;

/**
 * Reports whether `event` landed inside the editor's visible scrollport (or on
 * the body-mounted `floatBox` itself), rejecting outer chrome and sibling
 * overlays such as tab bars, sidebars, and find panels.
 */
export function isPointerInEditorViewport(
    event: MouseEvent,
    domNode: HTMLElement,
    floatBox: HTMLElement | null,
): boolean {
    const { target, clientX, clientY } = event;
    if (!(target instanceof Node))
        return false;

    const scrollContainer = findScrollContainer(domNode, document.documentElement);
    const isDocumentScroll = scrollContainer === document.documentElement;
    const isAllowedTarget = isDocumentScroll
        ? domNode.contains(target) || !!floatBox?.contains(target) || target === domNode.parentElement
        : scrollContainer.contains(target) || !!floatBox?.contains(target);
    if (!isAllowedTarget)
        return false;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    if (isDocumentScroll)
        return clientX >= 0 && clientX < viewportWidth && clientY >= 0 && clientY < viewportHeight;

    const rect = scrollContainer.getBoundingClientRect();
    const scrollportLeft = rect.left + scrollContainer.clientLeft;
    const scrollportTop = rect.top + scrollContainer.clientTop;
    const left = Math.max(0, scrollportLeft);
    const top = Math.max(0, scrollportTop);
    const right = Math.min(viewportWidth, scrollportLeft + scrollContainer.clientWidth);
    const bottom = Math.min(viewportHeight, scrollportTop + scrollContainer.clientHeight);
    return clientX >= left && clientX < right && clientY >= top && clientY < bottom;
}

/**
 * Floating UI middleware that keeps body-mounted block tools inside the
 * reference block's clipping ancestors and viewport.
 *
 * When a tall block's top edge scrolls past the clip top, the tool clamps down
 * to the clip top while staying within the block's own vertical bounds; when it
 * cannot fit without escaping the block or the clip rect, `data.clipped` is set
 * to `true` so the caller hides the tool instead of painting over host chrome.
 */
export function constrainToEditorViewport(): Middleware {
    return {
        name: EDITOR_VIEWPORT_MIDDLEWARE_NAME,
        async fn(state) {
            const { x, y, rects, platform } = state;
            // `altBoundary: true` resolves clipping ancestors from the reference
            // block inside the editor rather than the body-mounted floatBox.
            const overflow = await platform.detectOverflow(state, {
                altBoundary: true,
                boundary: 'clippingAncestors',
                rootBoundary: 'viewport',
            });

            if (overflow.left > SUBPIXEL_EPSILON || overflow.right > SUBPIXEL_EPSILON) {
                return {
                    data: { clipped: true } satisfies IEditorViewportConstraintData,
                };
            }

            let nextY = y;
            if (overflow.top > SUBPIXEL_EPSILON) {
                const clampedY = y + overflow.top;
                const maxBlockY = rects.reference.y + rects.reference.height - rects.floating.height;
                if (clampedY <= maxBlockY + SUBPIXEL_EPSILON && overflow.bottom + overflow.top <= SUBPIXEL_EPSILON) {
                    nextY = clampedY;
                }
                else {
                    return {
                        data: { clipped: true } satisfies IEditorViewportConstraintData,
                    };
                }
            }
            else if (overflow.bottom > SUBPIXEL_EPSILON) {
                return {
                    data: { clipped: true } satisfies IEditorViewportConstraintData,
                };
            }

            return {
                x,
                y: nextY,
                data: { clipped: false } satisfies IEditorViewportConstraintData,
            };
        },
    };
}
