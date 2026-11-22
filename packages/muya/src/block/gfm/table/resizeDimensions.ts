// Pixels reserved for resizing between the painted bottom border and the column move handle.
export const BOTTOM_RESIZE_MARGIN = 3;

/** Space left by dimensions at their minimum is shared in the original proportions. */
export function scaleSizes(sizes: number[], minima: number[], total: number, target: number) {
    let remaining = target;
    let weight = total;
    const byLimit = sizes.map((size, i) => ({ size, minimum: minima[i] }))
        .sort((a, b) => b.minimum / b.size - a.minimum / a.size);
    for (const { size, minimum } of byLimit) {
        if (size * remaining >= minimum * weight)
            break;
        remaining -= minimum;
        weight -= size;
    }
    const scale = weight ? remaining / weight : 0;
    let idealEdge = 0;
    let displayedEdge = 0;
    return sizes.map((size, i) => {
        const ideal = Math.max(minima[i], size * scale);
        idealEdge += ideal;
        // Markdown stores whole pixels, but an automatic row can have a fractional content height.
        const displayed = ideal === minima[i] ? ideal : Math.max(minima[i], Math.round(idealEdge - displayedEdge));
        displayedEdge += displayed;
        return displayed;
    });
}
