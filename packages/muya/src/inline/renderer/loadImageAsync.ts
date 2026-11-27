import type { PagePreviews } from '../../editor/pagePreviews';
import type { ImageMounts } from '../resources/imageMounts';
import type { ImageResources } from '../resources/images';
import { getUniqueId } from '../../utils';
import { mountImage } from '../resources/mountImage';

interface IImageRenderHost {
    images: ImageResources;
    mounts: ImageMounts;
    environment: { root: HTMLElement; previewScope?: PagePreviews };
}

export default function loadImageAsync(
    this: IImageRenderHost,
    imageInfo: { isUnknownType: boolean; src: string; load?: (signal?: AbortSignal) => Promise<string> },
    attrs: Record<string, string>,
    className?: string,
    imageClass?: string,
) {
    const { src, isUnknownType } = imageInfo;
    const cached = this.images.get(src);
    // Each render occurrence owns its placeholder, even when requests are shared.
    if (cached?.isSuccess)
        return { ...cached, id: getUniqueId() };

    const { root, previewScope } = this.environment;
    const resolve = imageInfo.load;
    const load = () => {
        const signal = previewScope?.visibilitySignal;
        return this.images.request(src, isUnknownType, resolve && (() => resolve(signal)));
    };
    const request = previewScope && imageInfo.load ? load : load();
    const id = this.mounts.watch(root, request, (placeholder, result) => {
        const latest = this.images.isCurrent(src, result) ? result : this.images.get(src);
        if (!latest)
            return;
        mountImage(placeholder, latest, attrs, className, imageClass);
    }, previewScope);
    return { id, isSuccess: undefined, url: undefined, width: undefined, height: undefined };
}
