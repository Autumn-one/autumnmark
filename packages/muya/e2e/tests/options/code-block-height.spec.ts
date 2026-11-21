import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown } from '../helpers/keyboard';

const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
const code = (info = '', text = body) => `~~~~${info}\n${text}\n~~~~\n`;
const rows = (block: Locator) => block.locator('.mu-code').evaluate(el => Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)));

async function openFirstBlockMenu(page: Page) {
    await page.locator('.mu-code-resize').first().click({ button: 'right' });
    await expect(page.locator('.mu-front-menu')).toBeInViewport();
}

test('saves a drag as one edit, reloads it and resets to the current default', async ({ page }) => {
    const info = 'ts title="example max-lines=4" {2}';
    const original = `${code(info)}\n${code('max-lines=3')}`;
    await loadMarkdown(page, original);
    const all = page.locator('.mu-code-block');
    const first = all.first();
    const other = all.last();
    await expect.poll(() => rows(first)).toBe(12);
    await expect.poll(() => rows(other)).toBe(3);
    const handle = first.getByRole('button', { name: 'Resize code block' });
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const lineHeight = await first.locator('.mu-code').evaluate(el => Number.parseFloat(getComputedStyle(el).lineHeight));
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 5 * lineHeight, { steps: 6 });
    await expect(handle).toHaveAttribute('data-lines', 'Rows: 7');
    await expect.poll(() => rows(first)).toBe(7);
    expect(await getMarkdown(page)).toBe(original);
    await page.mouse.up();
    const saved = original.replace(info, `${info} max-lines=7`);
    expect(await getMarkdown(page)).toBe(saved);
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(original);
    await expect.poll(() => rows(first)).toBe(12);
    await page.evaluate(() => window.muya!.redo());
    expect(await getMarkdown(page)).toBe(saved);

    await loadMarkdown(page, saved);
    await page.evaluate(() => window.muya!.setOptions({ compactMode: false, compactCodeMaxLines: 5 }));
    await expect.poll(() => rows(first)).toBe(7);
    await expect.poll(() => rows(other)).toBe(3);
    await first.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect.poll(() => rows(first)).toBe(30);
    await first.getByRole('button', { name: 'Collapse' }).click();
    await expect.poll(() => rows(first)).toBe(7);
    expect(await getMarkdown(page)).toBe(saved);
    await handle.dblclick();
    expect(await getMarkdown(page)).toBe(original);
    await expect.poll(() => rows(first)).toBe(30);
    await page.evaluate(() => window.muya!.setOptions({ compactMode: true }));
    await expect.poll(() => rows(first)).toBe(5);
    await expect.poll(() => rows(other)).toBe(3);
});

test('menu can persist full display or restore inheritance, including for indented code', async ({ page }) => {
    const original = body.split('\n').map(line => `    ${line}`).join('\n') + '\n';
    await loadMarkdown(page, original);
    const block = page.locator('.mu-code-block');
    await expect.poll(() => rows(block)).toBe(12);
    await openFirstBlockMenu(page);
    await page.getByText('Always show full code', { exact: true }).click();
    const saved = await getMarkdown(page);
    expect(saved).toBe(`\`\`\`max-lines=none\n${body}\n\`\`\`\n`);
    await expect.poll(() => rows(block)).toBe(30);
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(original);
    await loadMarkdown(page, saved);
    await expect.poll(() => rows(block)).toBe(30);
    await openFirstBlockMenu(page);
    await page.getByText('Follow compact mode', { exact: true }).click();
    expect(await getMarkdown(page)).toBe(saved.replace('max-lines=none', ''));
    await expect.poll(() => rows(block)).toBe(12);
});

test('counts wrapped rows, fits short content and prints all lines', async ({ page }) => {
    await page.evaluate(() => window.muya!.setOptions({ compactMode: false, wrapCodeBlocks: true }));
    await loadMarkdown(page, `${code('max-lines=2', 'wrapped '.repeat(500))}\n${code('max-lines=18', 'short')}`);
    const all = page.locator('.mu-code-block');
    await expect.poll(() => rows(all.first())).toBe(2);
    await expect.poll(() => rows(all.last())).toBe(1);
    await page.emulateMedia({ media: 'print' });
    await expect(all.first().locator('.mu-code-resize')).toBeHidden();
    await expect.poll(() => rows(all.first())).toBeGreaterThan(2);
});

test('canceling a drag restores the temporary expansion without editing the document', async ({ page }) => {
    const original = code('max-lines=4');
    await loadMarkdown(page, original);
    const block = page.locator('.mu-code-block');
    await block.getByRole('button', { name: 'Expand all', exact: true }).click();
    const handle = block.locator('.mu-code-resize');
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100);
    await expect(handle).toHaveAttribute('data-lines', /\d+/);
    await handle.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect.poll(() => rows(block)).toBe(30);
    expect(await getMarkdown(page)).toBe(original);
    await page.evaluate(() => window.muya!.setReadOnly(true));
    await expect(handle).toBeHidden();
});
