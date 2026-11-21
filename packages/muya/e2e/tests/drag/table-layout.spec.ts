import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';

const table = '| A | B | C |\n| --- | --- | --- |\n| first | x | y |\n| second | p | q |\n';
const marker = '<!-- table-layout: col-widths="2:150" row-min-heights="2:70" -->';

async function box(page: Page, row: number, col: number) {
    const rect = await page.locator('.mu-table-inner tr').nth(row).locator('td').nth(col).boundingBox();
    if (!rect)
        throw new Error('Cell is not visible');
    return rect;
}

async function edges(page: Page) {
    return page.locator('.mu-table-inner tr').first().locator('td').evaluateAll(cells =>
        cells.map(cell => Math.round(cell.getBoundingClientRect().right)));
}

for (const leadingWidth of ['auto', '100%']) {
    test(`dragging the outside edge in a full table with a ${leadingWidth} first column follows the pointer`, async ({ page }) => {
        const widths = leadingWidth === 'auto' ? '3:140' : '1:100%,3:140';
        const source = `<!-- table-layout: col-widths="${widths}" -->\n\n${table.replace('first', 'Long text '.repeat(50))}`;
        await page.evaluate(md => window.muya!.setContent(md), source);
        await page.addStyleTag({ content: 'figure.mu-table { width: 440px; }' });
        const before = await edges(page);
        const last = await box(page, 0, 2);
        const y = last.y + last.height / 2;
        const x = last.x + last.width - 1;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (const delta of [-18, -42, -27]) {
            await page.mouse.move(x + delta, y, { steps: 3 });
            expect(await edges(page)).toEqual([before[0], before[1], before[2] + delta]);
        }
        await page.mouse.up();
        const after = await edges(page);
        expect(after).toEqual([before[0], before[1], before[2] - 27]);
        const saved = await getMarkdown(page);
        await page.evaluate(() => window.muya!.undo());
        expect(await edges(page)).toEqual(before);
        await page.evaluate(md => window.muya!.setContent(md), saved);
        expect(await edges(page)).toEqual(after);
    });
}

test('a theme can fill automatic tables and double-click restores that default', async ({ page }) => {
    await page.addStyleTag({ content: 'figure.mu-table { width: 800px; } .mu-table-inner { width: 100%; }' });
    const source = '<!-- table-layout: col-widths="1:395,2:240,3:100%" row-min-heights="1:52" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const before = await edges(page);
    const last = await box(page, 0, 2);
    const x = last.x + last.width - 1;
    const y = last.y + last.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 24, y, { steps: 5 });
    const expected = [before[0], before[1], before[2] - 24];
    expect(await edges(page)).toEqual(expected);
    await page.mouse.up();
    const saved = await getMarkdown(page);
    await page.evaluate(md => window.muya!.setContent(md), saved);
    expect(await edges(page)).toEqual(expected);
    for (const index of [2, 1, 0]) {
        const cell = await box(page, 0, index);
        await page.mouse.dblclick(cell.x + cell.width - 1, y);
    }
    expect(await getMarkdown(page)).not.toContain('col-widths=');
    expect((await edges(page))[2]).toBe(before[2]);
});

test('a middle divider follows the pointer when saved widths exceed the available space', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:250,2:300,3:350" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    await page.addStyleTag({ content: 'figure.mu-table { width: 440px; }' });
    const before = await edges(page);
    const middle = await box(page, 0, 1);
    const y = middle.y + middle.height / 2;
    const x = middle.x + middle.width - 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 24, y, { steps: 4 });
    const during = await edges(page);
    expect(Math.abs(during[0] - before[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(during[1] - (before[1] - 24))).toBeLessThanOrEqual(1);
    await page.mouse.up();
    expect(await edges(page)).toEqual(during);
});

test('saves a boundary drag as 100% and follows the container after reopening', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="2:120" -->\n\n' + table.replace('q', 'longword'.repeat(80));
    await page.evaluate(md => window.muya!.setContent(md), source);
    const figure = page.locator('figure.mu-table');
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; }' });
    const grid = figure.locator('table');
    const first = await box(page, 0, 0);
    const y = first.y + first.height / 2;
    await page.mouse.move(first.x + first.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(first.x + 700, y, { steps: 5 });
    expect((await grid.boundingBox())!.width).toBeCloseTo(400, 0);
    const width = (await box(page, 0, 0)).width;
    expect((await box(page, 0, 1)).width).toBeCloseTo(120, 0);
    await page.mouse.up();
    const saved = await getMarkdown(page);
    expect(saved).toContain('col-widths="1:100%,2:120"');
    expect((await grid.boundingBox())!.width).toBeCloseTo(400, 0);
    await page.evaluate(md => window.muya!.setContent(md), saved);
    await figure.evaluate(el => el.style.width = '580px');
    expect((await grid.boundingBox())!.width).toBeCloseTo(580, 0);
    expect((await box(page, 0, 0)).width).toBeCloseTo(width + 180, 0);
    expect((await box(page, 0, 1)).width).toBeCloseTo(120, 0);
    expect(await getMarkdown(page)).toBe(saved);
});

test('fits saved widths to a narrower container and restores them when space returns', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:230,2:130" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const figure = page.locator('figure.mu-table');
    const md = await getMarkdown(page);
    await figure.evaluate(el => el.style.width = '280px');
    expect((await figure.locator('table').boundingBox())!.width).toBeLessThanOrEqual(280);
    expect(await getMarkdown(page)).toBe(md);
    await figure.evaluate(el => el.style.width = '550px');
    expect((await box(page, 0, 0)).width).toBeCloseTo(230, 0);
    expect((await box(page, 0, 1)).width).toBeCloseTo(130, 0);
});

test('the last edge of a single column stops inside the figure padding', async ({ page }) => {
    await page.evaluate(() => window.muya!.setContent('| A |\n| --- |\n| one |'));
    await page.addStyleTag({ content: 'figure.mu-table { box-sizing: border-box; width: 320px; padding-inline: 10px; }' });
    const figure = page.locator('figure.mu-table');
    const cell = await box(page, 0, 0);
    const y = cell.y + cell.height / 2;
    await page.mouse.move(cell.x + cell.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(cell.x + 500, y, { steps: 5 });
    expect((await box(page, 0, 0)).width).toBe(300);
    expect(await figure.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    await page.mouse.up();
    expect(await getMarkdown(page)).toContain('col-widths="1:100%"');
    await page.mouse.move(cell.x + 299, y);
    await page.mouse.down();
    await page.mouse.move(cell.x + 295, y, { steps: 3 });
    await page.mouse.up();
    expect(await getMarkdown(page)).toContain('col-widths="1:296"');
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toContain('col-widths="1:100%"');
    await page.mouse.dblclick(cell.x + 299, y);
    await expect.poll(() => getMarkdown(page)).not.toContain('table-layout');
});

test('dragging another column to the limit transfers the remaining space', async ({ page }) => {
    await page.evaluate(md => window.muya!.setContent(md), '<!-- table-layout: col-widths="1:100%,2:120" -->\n\n' + table);
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; }' });
    const before = await getMarkdown(page);
    const originalEdges = await edges(page);
    const first = await box(page, 0, 0);
    const third = await box(page, 0, 2);
    const y = third.y + third.height / 2;
    await page.mouse.move(third.x + third.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(third.x + 500, y, { steps: 4 });
    await page.mouse.up();
    expect(await getMarkdown(page)).toContain(`col-widths="1:${Math.round(first.width)},2:120,3:100%"`);
    expect(await edges(page)).toEqual(originalEdges);
    expect((await box(page, 0, 1)).width).toBeCloseTo(120, 0);
    await page.locator('figure.mu-table').evaluate(el => el.style.width = '500px');
    expect((await box(page, 0, 2)).width).toBeCloseTo(third.width + 100, 0);
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(before);
});

test('an exported fill column grows with the page while its pixel neighbour keeps its width', async ({ page }) => {
    const md = '<!-- table-layout: col-widths="1:100%,2:120" -->\n\n' + table;
    const html = await page.evaluate(source => new window.MarkdownToHtml!(source).generate(), md);
    await page.setContent(html);
    const article = page.locator('article.markdown-body');
    const grid = article.locator('table');
    const cells = grid.locator('th');
    await article.evaluate(el => { el.style.boxSizing = 'content-box'; el.style.width = '400px'; });
    expect((await grid.boundingBox())!.width).toBeCloseTo(400, 0);
    const first = (await cells.first().boundingBox())!.width;
    await article.evaluate(el => el.style.width = '600px');
    expect((await cells.first().boundingBox())!.width).toBeCloseTo(first + 200, 0);
    expect((await cells.nth(1).boundingBox())!.width).toBeCloseTo(120, 0);
});

test('keeps intrinsically wide tables scrollable inside their figure', async ({ page }) => {
    const columns = '| A '.repeat(24) + '|\n' + '| --- '.repeat(24) + '|';
    await page.evaluate(md => window.muya!.setContent(md), columns);
    const figure = page.locator('figure.mu-table');
    await page.addStyleTag({ content: 'figure.mu-table { width: 280px; }' });
    await figure.evaluate(el => { el.scrollLeft = 100; });
    const cell = await box(page, 0, 3);
    const y = cell.y + cell.height / 2;
    await page.mouse.move(cell.x + cell.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(cell.x + cell.width - 11, y, { steps: 3 });
    const preview = await box(page, 0, 3);
    expect(preview.x).toBe(cell.x);
    expect(preview.width).toBeCloseTo(cell.width - 10, 0);
    await page.mouse.up();
    expect(await figure.evaluate(el => el.scrollLeft)).toBe(100);
    expect(await box(page, 0, 3)).toEqual(preview);
    expect(await getMarkdown(page)).toContain(`col-widths="4:${Math.round(cell.width) - 10}"`);
});

test('resizes both axes, reopens, undoes and resets without serializing automatic sizes', async ({ page }) => {
    await page.evaluate(md => window.muya!.setContent(md), table);
    const first = await box(page, 0, 0);
    const x = first.x + first.width - 1;
    const y = first.y + first.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150 - first.width, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => getMarkdown(page)).toContain('col-widths="1:150"');
    expect((await box(page, 2, 0)).width).toBeCloseTo(150, 0);
    const body = await box(page, 1, 0);
    await page.mouse.move(body.x + 20, body.y + body.height - 1);
    await page.mouse.down();
    await page.mouse.move(body.x + 20, body.y + 69, { steps: 5 });
    await page.mouse.up();
    const saved = await getMarkdown(page);
    expect(saved).toContain('col-widths="1:150" row-min-heights="2:70"');
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).not.toContain('row-min-heights');
    await page.evaluate(md => window.muya!.setContent(md), saved);
    const reopened = await box(page, 1, 0);
    expect(reopened.height).toBeCloseTo(70, 0);
    expect(reopened.width).toBeCloseTo(150, 0);
    await page.mouse.dblclick(reopened.x + 20, reopened.y + reopened.height - 1);
    await expect.poll(() => getMarkdown(page)).not.toContain('row-min-heights');
    const header = await box(page, 0, 0);
    await page.mouse.dblclick(header.x + header.width - 1, header.y + 12);
    await expect.poll(() => getMarkdown(page)).not.toContain('table-layout');
});

async function moveHandle(page: Page, axis: 'row' | 'column', from: number, to: number) {
    const column = axis === 'column';
    const source = await box(page, column ? 2 : from, column ? from : 2);
    const target = await box(page, column ? 2 : to, column ? to : 2);
    const x = column ? source.x + source.width / 2 : source.x + source.width + 5;
    const y = column ? source.y + source.height + 5 : source.y + source.height / 2;
    await page.mouse.move(x, y);
    const handle = page.locator(`.mu-table-drag-bar[data-drag="${column ? 'bottom' : 'right'}"]`);
    await expect.poll(() => handle.evaluate(el => Number((el.parentElement as HTMLElement).style.opacity))).toBe(1);
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(column ? target.x + 2 : x, column ? y : target.y + 2, { steps: 5 });
    await page.mouse.up();
}

test('moves dimensions with rows and columns, preserves the header and undoes each move', async ({ page }) => {
    await page.evaluate(md => window.muya!.setContent(md), marker + '\n\n' + table);
    const before = await getMarkdown(page);
    await moveHandle(page, 'row', 2, 0);
    const reordered = await getMarkdown(page);
    expect(reordered).toContain('row-min-heights="3:70"');
    expect(reordered).toMatch(/\|\s*A\s*\|\s*B\s*\|\s*C\s*\|/);
    expect(reordered.indexOf('second')).toBeLessThan(reordered.indexOf('first'));
    await moveHandle(page, 'column', 1, 0);
    expect(await getMarkdown(page)).toContain('col-widths="1:150"');
    expect((await box(page, 0, 0)).width).toBeCloseTo(150, 0);
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(reordered);
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(before);
    await moveHandle(page, 'row', 0, 2);
    expect(await getMarkdown(page)).toBe(before);
});
