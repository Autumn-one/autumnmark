import type { Mermaid, MermaidConfig } from 'mermaid';
import loadRenderer from './index';

let renderCount = 0;
let renderQueue: Promise<void> = Promise.resolve();

interface ICachedMermaidSvg {
    svg: string;
    baseId: string;
    interactive: boolean;
}

const MAX_MERMAID_SVG_CACHE = 64;
// Scope the SVG cache per loaded Mermaid instance so test mocks never share cached output across cases.
let mermaidSvgCache = new WeakMap<object, Map<string, ICachedMermaidSvg>>();

function getInstanceCache(mermaid: object): Map<string, ICachedMermaidSvg> {
    let cache = mermaidSvgCache.get(mermaid);
    if (!cache) {
        cache = new Map();
        mermaidSvgCache.set(mermaid, cache);
    }
    return cache;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite every SVG ID, CSS selector, and fragment reference generated under `fromId`
 * to a unique `toId` so multiple blocks with identical Mermaid source never collide.
 */
export function rewriteMermaidSvgIds(svg: string, fromId: string, toId: string): string {
    if (fromId === toId || !fromId)
        return svg;
    const pattern = new RegExp(`${escapeRegExp(fromId)}(?![0-9])`, 'g');
    return svg.replace(pattern, toId);
}

export function clearMermaidSvgCache(): void {
    mermaidSvgCache = new WeakMap();
}

function cacheKey(theme: string, fontSize: string, code: string): string {
    return JSON.stringify([theme, fontSize, code]);
}

function readTargetFontSize(target: HTMLElement): string {
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function')
        return '';
    try {
        return window.getComputedStyle(target).fontSize || '';
    }
    catch {
        return '';
    }
}

interface IMermaidRenderOptions {
    target: HTMLElement;
    theme: string;
    code?: string;
    isCurrent?: () => boolean;
}

// Each diagram owns the shared configuration until rendering and binding finish.
// Omit code to preserve Mermaid.run's HTML/entity handling for export nodes.
export function renderMermaid({ target, theme, code, isCurrent }: IMermaidRenderOptions): Promise<void> {
    const result = renderQueue.then(async () => {
        if (isCurrent && !isCurrent())
            return;
        const mermaid: Mermaid = await loadRenderer('mermaid');
        if (isCurrent && !isCurrent())
            return;
        const cache = getInstanceCache(mermaid);

        if (code !== undefined) {
            const fontSize = readTargetFontSize(target);
            const key = cacheKey(theme, fontSize, code);
            const cached = cache.get(key);
            if (cached && !cached.interactive) {
                cache.delete(key);
                cache.set(key, cached);
                const nextId = `mu-mermaid-${++renderCount}`;
                target.innerHTML = rewriteMermaidSvgIds(cached.svg, cached.baseId, nextId);
                return;
            }
        }

        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            // Muya accepts theme strings; Mermaid falls back for unrecognized names.
            theme: theme as MermaidConfig['theme'],
        });

        if (code === undefined) {
            await mermaid.run({ nodes: [target] });
            return;
        }

        const fontSize = readTargetFontSize(target);
        const key = cacheKey(theme, fontSize, code);

        await mermaid.parse(code);
        if (isCurrent && !isCurrent())
            return;
        // Same-millisecond previews must not share Mermaid's document-wide SVG IDs (#5023).
        const renderId = `mu-mermaid-${++renderCount}`;
        const { svg, bindFunctions } = await mermaid.render(
            renderId,
            code,
            target,
        );
        if (isCurrent && !isCurrent())
            return;
        target.innerHTML = svg;
        bindFunctions?.(target);

        const interactive = typeof bindFunctions === 'function' && /\bclick\s+\S/.test(code);
        if (!interactive) {
            if (cache.size >= MAX_MERMAID_SVG_CACHE) {
                const oldest = cache.keys().next().value;
                if (oldest !== undefined)
                    cache.delete(oldest);
            }
            cache.set(key, { svg, baseId: renderId, interactive: false });
        }
    });
    renderQueue = result.catch(() => {});
    return result;
}
