import type { Locator } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor, floats } from '../helpers/selectors';

/**
 * #2939 — the ImageResizeBar positioned its left/right handles once on image
 * click and never tracked layout reflow (unlike imageToolbar, which rides
 * baseFloat's `autoUpdate`). When the surrounding layout shifted — the desktop
 * sidebar toggling, or any window/ancestor resize — the handles stayed at their
 * stale coordinates, detached from the image.
 *
 * Reproduce the reflow with a viewport resize (the muya container is centered,
 * so narrowing the viewport moves the image's left edge) and assert the left
 * handle stays aligned with the image.
 */

const DATA_URI = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="teal"/></svg>',
)}`;

test.describe('ImageResizeBar reflow (#2939)', () => {
    test('left handle tracks the image when the viewport resizes', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.evaluate(uri => window.muya!.setContent(`![alt](${uri})`), DATA_URI);

        const image = page.locator(editor.image).first();
        await expect(image).toBeVisible();
        await expect.poll(async () => image.evaluate(el =>
            el.classList.contains('mu-image-success')), { timeout: 5_000 }).toBe(true);

        const innerImg = image.locator('img').first();
        await innerImg.click();

        const leftHandle = page.locator(`${floats.imageTransformer} .bar.left`);
        await expect(leftHandle).toBeVisible();

        const offsetBefore = await getHandleOffset(innerImg, leftHandle);
        expect(Math.abs(offsetBefore)).toBeLessThan(4);

        // Narrow the viewport: the centered container — and the image — shift right.
        await page.setViewportSize({ width: 760, height: 900 });

        await expect.poll(async () => Math.abs(await getHandleOffset(innerImg, leftHandle)), {
            timeout: 5_000,
            intervals: [50, 100, 250, 500],
        }).toBeLessThan(4);
    });
});

async function getHandleOffset(img: Locator, handle: Locator): Promise<number> {
    const imgBox = await img.boundingBox();
    const handleBox = await handle.boundingBox();
    if (!imgBox || !handleBox)
        throw new Error('missing bounding box');
    // The left handle sits at `image.left - 5` (CIRCLE_RADIO); compare centers.
    return (handleBox.x + handleBox.width / 2) - imgBox.x;
}

async function contentInnerWidth(content: Locator): Promise<number> {
    return content.evaluate((el) => {
        const style = getComputedStyle(el);
        const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
        return Math.round(el.clientWidth - padding);
    });
}

test.describe('ImageResizeBar full-width 100% layout', () => {
    test('inline image expands to 100% beyond natural width and tracks viewport widen/narrow', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 900 });
        await page.evaluate(uri => window.muya!.setContent(`![alt](${uri})`), DATA_URI);

        const content = page.locator('.mu-paragraph-content').first();
        const wrapper = page.locator(editor.image).first();
        await expect(wrapper).toBeVisible();
        await expect.poll(async () => wrapper.evaluate(el =>
            el.classList.contains('mu-image-success')), { timeout: 5_000 }).toBe(true);

        const innerImg = wrapper.locator('img').first();
        await innerImg.click();

        const rightHandle = page.locator(`${floats.imageTransformer} .bar.right`);
        await expect(rightHandle).toBeVisible();

        const handleBox = (await rightHandle.boundingBox())!;
        const contentBox = (await content.boundingBox())!;
        const startX = handleBox.x + handleBox.width / 2;
        const startY = handleBox.y + handleBox.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(contentBox.x + contentBox.width + 40, startY, { steps: 10 });
        await page.mouse.up();

        const markdown = await page.evaluate(() => window.muya!.getMarkdown());
        expect(markdown).toContain('width="100%"');
        await expect(wrapper).toHaveClass(/mu-image-full-width/);

        const assertMatchesContentWidth = async () => {
            await expect.poll(async () => {
                const expected = await contentInnerWidth(content);
                const actual = Math.round((await wrapper.locator('img').first().boundingBox())!.width);
                return Math.abs(actual - expected);
            }, { timeout: 5_000 }).toBeLessThanOrEqual(2);
        };

        const initialExpected = await contentInnerWidth(content);
        expect(initialExpected).toBeGreaterThan(420);
        await assertMatchesContentWidth();

        // Widen viewport: the 100% image must grow past the drag-time pixel width.
        await page.setViewportSize({ width: 1400, height: 900 });
        await expect.poll(async () => contentInnerWidth(content), { timeout: 5_000 }).toBeGreaterThan(initialExpected);
        await assertMatchesContentWidth();

        // Narrow viewport: the 100% image must shrink to fit the narrower container.
        await page.setViewportSize({ width: 620, height: 900 });
        await expect.poll(async () => contentInnerWidth(content), { timeout: 5_000 }).toBeLessThan(initialExpected);
        await assertMatchesContentWidth();
    });

    test('embedded picture expands to 100% beyond natural width and tracks viewport widen/narrow', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 900 });
        await page.evaluate((uri) => {
            window.muya!.options.editEmbeddedImage = () => {};
            window.muya!.setContent(`![alt](${uri})`);
        }, DATA_URI);

        try {
            const content = page.locator('.mu-paragraph-content').first();
            const picture = page.locator('.mu-embedded-picture').first();
            const img = picture.locator('img').first();
            await expect(img).toBeVisible();

            await img.hover();
            const rightHandle = page.locator(`${floats.imageTransformer} .bar.right`);
            await expect(rightHandle).toBeVisible();

            const handleBox = (await rightHandle.boundingBox())!;
            const contentBox = (await content.boundingBox())!;
            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(contentBox.x + contentBox.width + 40, startY, { steps: 10 });
            await page.mouse.up();

            const markdown = await page.evaluate(() => window.muya!.getMarkdown());
            expect(markdown).toContain('width="100%"');
            await expect(picture).toHaveClass(/mu-image-full-width/);

            const assertMatchesContentWidth = async () => {
                await expect.poll(async () => {
                    const expected = await contentInnerWidth(content);
                    const actual = Math.round((await picture.locator('img').first().boundingBox())!.width);
                    return Math.abs(actual - expected);
                }, { timeout: 5_000 }).toBeLessThanOrEqual(2);
            };

            const initialExpected = await contentInnerWidth(content);
            expect(initialExpected).toBeGreaterThan(420);
            await assertMatchesContentWidth();

            await page.setViewportSize({ width: 1400, height: 900 });
            await expect.poll(async () => contentInnerWidth(content), { timeout: 5_000 }).toBeGreaterThan(initialExpected);
            await assertMatchesContentWidth();

            await page.setViewportSize({ width: 620, height: 900 });
            await expect.poll(async () => contentInnerWidth(content), { timeout: 5_000 }).toBeLessThan(initialExpected);
            await assertMatchesContentWidth();
        }
        finally {
            await page.evaluate(() => {
                window.muya!.options.editEmbeddedImage = undefined;
            });
        }
    });
});
