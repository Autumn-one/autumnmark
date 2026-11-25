import { expect, test } from '../fixtures/muya';
import { loadMarkdown } from '../helpers/keyboard';

// Headless Chromium hides scrollbars by default, masking width changes in compact previews.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('keeps a near-threshold image stable across document selection and resizing', async ({ page }) => {
    await page.evaluate(() => window.muya!.setOptions({ compactImageMaxHeight: 320 }));
    await page.addStyleTag({ content: `
        .mu-paragraph-content { width: 400px }
        .mu-paragraph-content::-webkit-scrollbar { width: 16px }
    ` });
    await page.route('**/threshold-image.svg', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650"></svg>',
    }));
    await loadMarkdown(page, 'First paragraph\n\n![image](http://localhost:5174/threshold-image.svg)\n\nLast paragraph');
    const image = page.locator('.mu-compact-image-body img');
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(800);
    await page.locator('.mu-paragraph-content').first().click();
    const selectedText = () => page.evaluate(() => window.getSelection()?.toString());
    await page.evaluate(() => window.muya!.selectAll());
    await expect.poll(selectedText).toBe('First paragraph');
    await page.evaluate(() => window.muya!.selectAll());
    await expect.poll(selectedText).toMatch(/First paragraph[\s\S]*Last paragraph/);

    const viewport = page.locator('.mu-paragraph-content').nth(1);
    const expand = page.getByRole('button', { name: 'Expand', exact: true });
    await expect(expand).toBeVisible();
    const blockHeights = await viewport.evaluate(async (el) => {
        const heights = new Set<number>();
        for (let i = 0; i < 12; i++) {
            await new Promise(requestAnimationFrame);
            heights.add(el.parentElement!.offsetHeight);
        }
        return [...heights];
    });
    expect(blockHeights).toHaveLength(1);
    await viewport.evaluate(el => { el.style.width = '300px'; });
    await expect(expand).toHaveCount(0);
    await viewport.evaluate(el => { el.style.width = '500px'; });
    await expect(expand).toBeVisible();
});
