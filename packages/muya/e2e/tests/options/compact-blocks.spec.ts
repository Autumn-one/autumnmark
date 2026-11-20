import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown } from '../helpers/keyboard';

const fence = '```';
const lines = Array.from({ length: 48 }, (_, i) => 'line ' + (i + 1));

test('scrolls code with its gutter, then passes the wheel to the document', async ({ page }) => {
    const markdown = [fence, ...lines, fence, '', ...lines.map(line => line + '\n')].join('\n');
    await loadMarkdown(page, markdown);
    const block = page.locator('.mu-code-block');
    const viewport = block.locator('.mu-code');
    const toggle = block.getByRole('button', { name: 'Expand', exact: true });
    await expect(toggle).toBeVisible();
    await expect.poll(() => viewport.evaluate(el => Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)))).toBe(12);
    const originalMarkdown = await getMarkdown(page);
    const copied = await block.evaluate(async (el) => {
        let content = '';
        window.muya!.setOptions({ clipboardWriteText: async (text) => {
            content = text;
            return true;
        } });
        el.querySelector<HTMLButtonElement>('.mu-code-copy')!.click();
        return content;
    });
    expect(copied).toBe(lines.join('\n'));
    await viewport.hover();
    await page.mouse.wheel(0, 180);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => viewport.evaluate(el => {
        const content = el.querySelector('.mu-codeblock-content')!;
        const row = el.parentElement!.querySelector('.mu-line-numbers-rows > span')!;
        return Math.abs(content.getBoundingClientRect().top - row.getBoundingClientRect().top);
    })).toBeLessThan(2);
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const top = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 180);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(top);
    await toggle.click();
    await expect(block.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true');
    expect(await viewport.evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true);
    await block.getByRole('button', { name: 'Collapse' }).press('Enter');
    await expect(toggle).toBeVisible();
    expect(await getMarkdown(page)).toBe(originalMarkdown);
    await page.emulateMedia({ media: 'print' });
    await expect(toggle).toBeHidden();
    expect(await viewport.evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true);
});

test('counts wrapped rows and scrolls the caret into view without expanding', async ({ page }) => {
    await page.evaluate(() => window.muya!.setOptions({ compactCodeMaxLines: 3, wrapCodeBlocks: true }));
    await loadMarkdown(page, [fence, 'wrapping '.repeat(280), fence].join('\n'));
    const block = page.locator('.mu-code-block');
    const viewport = block.locator('.mu-code');
    const toggle = block.locator('.mu-compact-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.mu-codeblock-content').click({ position: { x: 5, y: 4 } });
    for (let i = 0; i < 6; i++)
        await page.keyboard.press('ArrowDown');
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.muya!.setOptions({ wrapCodeBlocks: false }));
    await expect(toggle).toHaveCount(0);
    expect(await block.locator('.mu-code').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('keeps the code toggle at the same screen position when collapsing with the keyboard', async ({ page }) => {
    await page.addStyleTag({ content: 'html { overflow-anchor: none }' });
    const paragraphs = lines.join('\n\n');
    await loadMarkdown(page, [paragraphs, [fence, ...lines, ...lines, fence].join('\n'), paragraphs].join('\n\n'));
    const toggle = page.locator('.mu-compact-toggle');
    await toggle.click();
    const before = await toggle.evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
        return el.getBoundingClientRect().top;
    });
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => toggle.evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(before, 0);
});

test('limits only standalone images and applies height preferences live', async ({ page }) => {
    await page.route('**/compact-image.svg', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="800"><rect width="240" height="800" fill="navy"/></svg>',
    }));
    const image = '![diagram](http://localhost:5174/compact-image.svg)';
    await loadMarkdown(page, [image, '', 'Inline ' + image, '', fence, 'short', fence, ''].join('\n'));
    const originalMarkdown = await getMarkdown(page);
    const viewport = page.locator('.mu-paragraph-content').first();
    const pic = viewport.locator('img');
    const toggle = page.locator('.mu-compact-toggle');
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAccessibleName('Expand');
    await expect(toggle).toHaveText('');
    await expect.poll(() => viewport.evaluate(el => el.clientHeight)).toBe(320);
    const margins = await viewport.evaluate((el) => {
        const picture = el.querySelector('img')!.getBoundingClientRect();
        const left = picture.left - el.getBoundingClientRect().left;
        return { left, right: el.clientWidth - left - picture.width, width: el.clientWidth };
    });
    expect(margins.left).toBeGreaterThan(10);
    expect(Math.abs(margins.left - margins.right)).toBeLessThan(2);
    await page.evaluate(() => {
        window.muya!.on('preview-image', ({ data }) => {
            document.body.dataset.preview = data;
        });
    });
    await viewport.click({ position: { x: margins.width - 5, y: 40 } });
    await expect(page.locator('body')).toHaveAttribute('data-preview', 'http://localhost:5174/compact-image.svg');
    const width = await pic.evaluate(el => el.getBoundingClientRect().width);
    await viewport.hover();
    await page.mouse.wheel(0, 120);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Collapse');
    expect(await viewport.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(800);
    expect(await pic.evaluate(el => el.getBoundingClientRect().width)).toBe(width);
    await toggle.click();
    await page.evaluate(() => window.muya!.setOptions({ compactImageMaxHeight: 800 }));
    await expect(toggle).toHaveCount(0);
    await page.evaluate(() => window.muya!.setOptions({ compactImageMaxHeight: 180 }));
    await expect.poll(() => viewport.evaluate(el => el.clientHeight)).toBe(180);
    await page.evaluate(() => window.muya!.setOptions({ compactMode: false }));
    await expect(toggle).toHaveCount(0);
    expect(await viewport.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(800);
    expect(await getMarkdown(page)).toBe(originalMarkdown);
});
