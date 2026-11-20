export function picturesOnRow(image: HTMLImageElement, top: number): HTMLImageElement[] {
    const content = image.closest('.mu-content');
    if (!content)
        return [];
    const pictures = content.querySelectorAll<HTMLImageElement>('.mu-inline-image img, .mu-embedded-picture img, .mu-image-marked-text + img');
    return Array.from(pictures).filter((element) => {
        const rect = element.getBoundingClientRect();
        return element !== image && rect.width > 0 && rect.height > 0 && Math.abs(rect.top - top) < 2;
    });
}

export function snapPictureWidth(width: number, ratio: number, top: number, peers: HTMLImageElement[]) {
    let nearest: { width: number; element: HTMLImageElement; axis: 'height' | 'width' } | undefined;
    let distance = Infinity;
    for (const peer of peers) {
        const rect = peer.getBoundingClientRect();
        if (!peer.isConnected || Math.abs(rect.top - top) >= 2)
            continue;
        for (const axis of ['height', 'width'] as const) {
            const target = Math.round(axis === 'height' ? rect.height * ratio : rect.width);
            const gap = Math.abs(width - target);
            // Use pointer travel in CSS pixels, independent of either picture's aspect ratio.
            if (target > 0 && gap <= 8 && gap < distance) {
                nearest = { width: target, element: peer, axis };
                distance = gap;
            }
        }
    }
    return nearest;
}
