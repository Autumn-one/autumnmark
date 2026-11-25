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

function expectScaledEdges(actual: number[], before: number[], left: number, delta: number) {
    const total = before[before.length - 1] - left;
    for (const [i, edge] of before.entries()) {
        const expected = edge + delta * (edge - left) / total;
        expect(Math.abs(actual[i] - expected)).toBeLessThanOrEqual(1);
    }
}

for (const leadingWidth of ['auto', '100%']) {
    test(`dragging the outside edge in a full table with a ${leadingWidth} first column follows the pointer`, async ({ page }) => {
        const widths = leadingWidth === 'auto' ? '3:140' : '1:100%,3:140';
        const source = `<!-- table-layout: col-widths="${widths}" -->\n\n${table.replace('first', 'Long text '.repeat(50))}`;
        await page.evaluate(md => window.muya!.setContent(md), source);
        await page.addStyleTag({ content: 'figure.mu-table { width: 440px; }' });
        const before = await edges(page);
        const first = await box(page, 0, 0);
        const last = await box(page, 0, 2);
        const y = last.y + last.height / 2;
        const x = last.x + last.width - 1;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (const delta of [-18, -42, -27]) {
            await page.mouse.move(x + delta, y, { steps: 3 });
            expectScaledEdges(await edges(page), before, first.x, delta);
        }
        await page.mouse.up();
        const after = await edges(page);
        expectScaledEdges(after, before, first.x, -27);
        const saved = await getMarkdown(page);
        await page.evaluate(() => window.muya!.undo());
        expect(await edges(page)).toEqual(before);
        await page.evaluate(md => window.muya!.setContent(md), saved);
        expect(await edges(page)).toEqual(after);
    });
}

test('automatic tables fill the editor and double-click restores that default', async ({ page }) => {
    await page.addStyleTag({ content: 'figure.mu-table { width: 800px; }' });
    const grid = page.locator('.mu-table-inner');
    await page.evaluate(md => window.muya!.setContent(md), table);
    expect((await grid.boundingBox())!.width).toBeCloseTo(800, 0);
    expect(await getMarkdown(page)).not.toContain('col-widths=');

    const source = '<!-- table-layout: col-widths="1:395,2:240,3:100%" row-min-heights="1:52" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const before = await edges(page);
    const first = await box(page, 0, 0);
    const last = await box(page, 0, 2);
    const x = last.x + last.width - 1;
    const y = last.y + last.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 24, y, { steps: 5 });
    const expected = await edges(page);
    expectScaledEdges(expected, before, first.x, -24);
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
    await page.locator('figure.mu-table').evaluate(el => el.style.width = '560px');
    expect((await grid.boundingBox())!.width).toBeCloseTo(560, 0);
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
    expect(during[2]).toBe(before[2]);
    await page.mouse.up();
    expect(await edges(page)).toEqual(during);
});

test('dragging the outer edge to full width follows the container after reopening', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:60,2:90,3:150" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const figure = page.locator('figure.mu-table');
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; }' });
    const grid = figure.locator('table');
    const last = await box(page, 0, 2);
    const y = last.y + last.height / 2;
    await page.mouse.move(last.x + last.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(last.x + 700, y, { steps: 5 });
    expect((await grid.boundingBox())!.width).toBeCloseTo(400, 0);
    expect((await box(page, 0, 0)).width).toBeCloseTo(80, 0);
    expect((await box(page, 0, 2)).width).toBeCloseTo(200, 0);
    expect((await box(page, 0, 1)).width).toBeCloseTo(120, 0);
    await page.mouse.up();
    const saved = await getMarkdown(page);
    expect(saved).toContain('col-widths="1:80,2:120,3:100%"');
    expect((await grid.boundingBox())!.width).toBeCloseTo(400, 0);
    await page.evaluate(md => window.muya!.setContent(md), saved);
    await figure.evaluate(el => el.style.width = '580px');
    expect((await grid.boundingBox())!.width).toBeCloseTo(580, 0);
    expect((await box(page, 0, 2)).width).toBeCloseTo(380, 0);
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

test('a one-pixel drag to full width keeps automatic columns at their drop positions', async ({ page }) => {
    const source = '| A | B | C |\n| --- | --- | --- |\n| x | y | z |';
    await page.evaluate(md => window.muya!.setContent(md), source);
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; } .mu-table-inner { width: 399px; }' });
    const last = await box(page, 0, 2);
    const right = last.x + last.width;
    const y = last.y + last.height / 2;
    await page.mouse.move(right - 1, y);
    await page.mouse.down();
    await page.mouse.move(right, y);
    const during = await edges(page);
    await page.mouse.up();
    expect(await edges(page)).toEqual(during);
    expect(await getMarkdown(page)).toContain('3:100%"');
    await page.locator('figure.mu-table').evaluate(el => el.style.width = '500px');
    expect((await edges(page))[2]).toBe(during[2] + 100);
});

test('an outer drag redistributes width after columns reach their minimum and can be cancelled', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:60,2:120,3:180" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const before = await edges(page);
    const saved = await getMarkdown(page);
    const last = await box(page, 1, 2);
    const x = last.x + last.width - 1;
    const y = last.y + last.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const [delta, widths] of [[-216, [36, 43, 65]], [-340, [36, 36, 36]], [0, [60, 120, 180]]] as const) {
        await page.mouse.move(x + delta, y);
        for (const [i, width] of widths.entries())
            expect((await box(page, 0, i)).width).toBe(width);
    }
    await page.mouse.move(x - 90, y);
    const cell = page.locator('.mu-table-inner tr').nth(1).locator('td').last();
    await cell.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    expect(await edges(page)).toEqual(before);
    expect(await getMarkdown(page)).toBe(saved);
});

test('shrinking a fill column at an internal divider keeps both outer edges in place', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:120,2:100%,3:80" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; }' });
    const before = await edges(page);
    const cell = await box(page, 1, 0);
    const y = cell.y + cell.height / 2;
    await page.mouse.move(cell.x + cell.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(cell.x + 500, y);
    const expected = [before[1] - 36, before[1], before[2]];
    expect(await edges(page)).toEqual(expected);
    await page.mouse.up();
    const saved = await getMarkdown(page);
    await page.evaluate(md => window.muya!.setContent(md), saved);
    expect(await edges(page)).toEqual(expected);
});

test('a divider respects the minimum width imposed by cell padding', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="1:120,2:120,3:120" -->\n\n' + table.replace('first', '表格内容');
    await page.evaluate(md => window.muya!.setContent(md), source);
    await page.addStyleTag({ content: '.mu-table-inner { --mu-cell-padding-x: 32px; }' });
    const before = await edges(page);
    const middle = await box(page, 1, 1);
    const y = middle.y + middle.height / 2;
    await page.mouse.move(middle.x + middle.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(middle.x + middle.width + 120, y);
    const during = await edges(page);
    expect(during[0]).toBe(before[0]);
    expect(during[1]).toBeGreaterThan(before[1]);
    expect(during[2]).toBe(before[2]);
    await page.mouse.up();
    expect(await edges(page)).toEqual(during);
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

test('an internal divider stops at the adjacent minimum in a full-width table', async ({ page }) => {
    await page.evaluate(md => window.muya!.setContent(md), '<!-- table-layout: col-widths="1:100%,2:120" -->\n\n' + table);
    await page.addStyleTag({ content: 'figure.mu-table { width: 400px; }' });
    const before = await getMarkdown(page);
    const originalEdges = await edges(page);
    const first = await box(page, 0, 0);
    const y = first.y + first.height / 2;
    await page.mouse.move(first.x + first.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(first.x + 500, y, { steps: 4 });
    const expected = [originalEdges[0] + 84, originalEdges[1], originalEdges[2]];
    expect(await edges(page)).toEqual(expected);
    await page.mouse.up();
    expect(await getMarkdown(page)).toContain('col-widths="1:100%,2:36"');
    expect(await edges(page)).toEqual(expected);
    await page.locator('figure.mu-table').evaluate(el => el.style.width = '500px');
    expect((await box(page, 0, 0)).width).toBeCloseTo(first.width + 84 + 100, 0);
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
    const before = await edges(page);
    const y = cell.y + cell.height / 2;
    await page.mouse.move(cell.x + cell.width - 1, y);
    await page.mouse.down();
    await page.mouse.move(cell.x + cell.width - 11, y, { steps: 3 });
    const preview = await box(page, 0, 3);
    expect(preview.x).toBe(cell.x);
    expect(preview.width).toBeCloseTo(cell.width - 10, 0);
    const expected = before.map((edge, i) => i === 3 ? edge - 10 : edge);
    expect(await edges(page)).toEqual(expected);
    await page.mouse.up();
    expect(await figure.evaluate(el => el.scrollLeft)).toBe(100);
    expect(await box(page, 0, 3)).toEqual(preview);
    expect(await edges(page)).toEqual(expected);
});

async function rowHeights(page: Page) {
    return page.locator('.mu-table-inner tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
}

test('the exposed bottom border resizes a single automatic row down to its content height', async ({ page }) => {
    await page.evaluate(() => window.muya!.setContent('| Name | Value |\n| --- | --- |'));
    const original = await getMarkdown(page);
    const cell = await box(page, 0, 1);
    const x = cell.x + cell.width / 2;
    const y = Math.ceil(cell.y + cell.height) + 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40);
    expect((await rowHeights(page))[0]).toBeCloseTo(cell.height + 40, 0);
    await page.mouse.up();
    const grown = await box(page, 0, 1);
    await page.mouse.move(x, Math.ceil(grown.y + grown.height) + 1);
    await page.mouse.down();
    await page.mouse.move(x, y - 10);
    await page.mouse.up();
    expect(await rowHeights(page)).toEqual([cell.height]);
    expect(await getMarkdown(page)).toBe(original);
});

test('the bottom edge scales every row from its starting height in a single undo step', async ({ page }) => {
    const source = '<!-- table-layout: col-widths="2:120" row-min-heights="1:60,2:80,3:100" -->\n\n' + table;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const before = await getMarkdown(page);
    const columns = await edges(page);
    const last = await box(page, 2, 1);
    const x = last.x + last.width / 2;
    const y = last.y + last.height - 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const [delta, heights] of [[60, [75, 100, 125]], [-24, [54, 72, 90]], [24, [66, 88, 110]]] as const) {
        await page.mouse.move(x, y + delta, { steps: 3 });
        expect(await rowHeights(page)).toEqual(heights);
        expect(await edges(page)).toEqual(columns);
    }
    await page.mouse.up();
    const saved = await getMarkdown(page);
    expect(saved).toContain('row-min-heights="1:66,2:88,3:110"');
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toBe(before);
    await page.evaluate(md => window.muya!.setContent(md), saved);
    expect(await rowHeights(page)).toEqual([66, 88, 110]);
});

test('a horizontal divider stops at wrapped text and only trades height with the next row', async ({ page }) => {
    const wrapped = table.replace('first', 'long text '.repeat(10));
    const widths = 'col-widths="1:100,2:100,3:100"';
    await page.evaluate(md => window.muya!.setContent(md), `<!-- table-layout: ${widths} -->\n\n${wrapped}`);
    const natural = await rowHeights(page);
    expect(natural[1]).toBeGreaterThan(natural[0]);
    const middle = Math.ceil(natural[1]) + 24;
    const source = `<!-- table-layout: ${widths} row-min-heights="2:${middle},3:80" -->\n\n${wrapped}`;
    await page.evaluate(md => window.muya!.setContent(md), source);
    const saved = await getMarkdown(page);
    const last = await box(page, 2, 1);
    const x = last.x + last.width / 2;
    const y = last.y + 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 3 });
    const heights = await rowHeights(page);
    expect(heights[0]).toBe(natural[0]);
    expect(heights[1]).toBe(natural[1]);
    expect(Math.abs(heights[1] + heights[2] - (middle + 80))).toBeLessThanOrEqual(0.5);
    await page.locator('.mu-table-inner tr').nth(1).locator('td').nth(1).dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    expect(await rowHeights(page)).toEqual([natural[0], middle, 80]);
    expect(await getMarkdown(page)).toBe(saved);
});

test('resizes both axes, reopens, undoes and resets without serializing automatic sizes', async ({ page }) => {
    await page.evaluate(md => window.muya!.setContent(md), '<!-- table-layout: col-widths="1:100,2:140" row-min-heights="2:50,3:100" -->\n\n' + table);
    const first = await box(page, 0, 0);
    const x = first.x + first.width - 1;
    const y = first.y + first.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150 - first.width, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => getMarkdown(page)).toContain('col-widths="1:150,2:90"');
    expect((await box(page, 2, 0)).width).toBeCloseTo(150, 0);
    const body = await box(page, 1, 0);
    await page.mouse.move(body.x + 20, body.y + body.height - 1);
    await page.mouse.down();
    await page.mouse.move(body.x + 20, body.y + 69, { steps: 5 });
    await page.mouse.up();
    const saved = await getMarkdown(page);
    expect(saved).toContain('col-widths="1:150,2:90" row-min-heights="2:70,3:80"');
    await page.evaluate(() => window.muya!.undo());
    expect(await getMarkdown(page)).toContain('row-min-heights="2:50,3:100"');
    await page.evaluate(md => window.muya!.setContent(md), saved);
    const reopened = await box(page, 1, 0);
    expect(reopened.height).toBeCloseTo(70, 0);
    expect(reopened.width).toBeCloseTo(150, 0);
    await page.mouse.dblclick(reopened.x + 20, reopened.y + reopened.height - 1);
    expect(await getMarkdown(page)).toContain('row-min-heights="3:80"');
    const last = await box(page, 2, 0);
    await page.mouse.dblclick(last.x + 20, last.y + last.height - 1);
    await expect.poll(() => getMarkdown(page)).not.toContain('row-min-heights');
    const header = await box(page, 0, 0);
    await page.mouse.dblclick(header.x + header.width - 1, header.y + 12);
    const second = await box(page, 0, 1);
    await page.mouse.dblclick(second.x + second.width - 1, second.y + 12);
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
