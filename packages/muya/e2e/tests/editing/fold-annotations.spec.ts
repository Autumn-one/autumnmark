import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { focusEditor, loadMarkdown, slowType } from '../helpers/keyboard';
import { toolbar } from '../helpers/selectors';

const fence = '```js title="request.js" {2-3,5}';
const body = 'start()\nconfigure()\nconnect()\n\nfinish()';
const source = ['<!-- fold -->', '', '### Retry steps', '', fence, body, '```', '', '<!-- /fold -->', ''].join('\n');

test('renders code annotations inside a fold with an independent saved default', async ({ page }) => {
    await loadMarkdown(page, source);
    const toggle = page.getByRole('button', { name: 'Retry steps', exact: true });
    const caption = page.locator('.mu-code-block-title');
    const code = page.locator('.mu-code-block .mu-code');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(code).toBeHidden();
    await toggle.click();
    await expect(caption).toHaveText('request.js');
    await expect(caption).toBeVisible();
    await expect(code).toHaveCSS('background-image', /linear-gradient/);
    await expect.poll(() => page.locator('.mu-fold-block-header').evaluate((header) => {
        const panel = header.getBoundingClientRect();
        const body = header.parentElement!.querySelector('.mu-code-block')!.getBoundingClientRect();
        const surfaceBottom = panel.top + Number.parseFloat(getComputedStyle(header, '::before').height);
        return {
            bodyInset: panel.left < body.left && body.right < panel.right,
            bodyCovered: body.bottom < surfaceBottom,
        };
    })).toEqual({ bodyInset: true, bodyCovered: true });
    expect(await getMarkdown(page)).toBe(source);

    await toggle.click();
    await page.locator('.mu-fold-block-settings > summary').click();
    await page.getByRole('button', { name: 'Open by default' }).click();
    const saved = source.replace('<!-- fold -->', '<!-- fold open -->');
    await expect.poll(() => getMarkdown(page)).toBe(saved);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await loadMarkdown(page, saved);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(code).toBeVisible();
});

test('inserts a fold from the slash menu and starts editing its title', async ({ page }) => {
    await loadMarkdown(page, '');
    await focusEditor(page);
    await slowType(page, '/fold');
    await page.locator('[data-label="fold-block"]').click();
    await page.keyboard.insertText('New fold title');
    await page.keyboard.press('Enter');
    await slowType(page, 'Fold body.');
    await expect.poll(() => getMarkdown(page))
        .toBe('<!-- fold -->\n\n### New fold title\n\nFold body.\n\n<!-- /fold -->\n');
    await expect(page.getByRole('button', { name: 'New fold title' })).toBeVisible();
});

test('search reveals a match within a collapsed fold', async ({ page }) => {
    await loadMarkdown(page, source);
    const toggle = page.getByRole('button', { name: 'Retry steps', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator(toolbar.search).fill('configure');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.mu-code-block')).toBeVisible();
});

test('Up and Down reach a bold fold title and allow edits inside its markers', async ({ page }) => {
    const markdown = ['Before the fold.', '', '<!-- fold open -->', '', '__Retry steps__', '',
        'Read the response.', '', '<!-- /fold -->', '', 'After the fold.', ''].join('\n');
    await loadMarkdown(page, markdown);
    const toggle = page.locator('.mu-fold-block-toggle');
    const activeText = () => page.evaluate(() => window.muya!.editor.activeContentBlock?.text);

    await page.getByText('Before the fold.', { exact: true }).click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(activeText).toBe('__Retry steps__');
    await expect(toggle).toBeHidden();
    await page.keyboard.insertText('X');
    await expect.poll(() => getMarkdown(page)).toMatch(/\n__[^_\n]*X[^_\n]*__\n/);
    const editedTitle = await activeText();

    await page.keyboard.press('ArrowDown');
    await expect.poll(activeText).toBe('Read the response.');
    await expect(toggle).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect.poll(activeText).toBe(editedTitle);
    await page.keyboard.press('ArrowUp');
    await expect.poll(activeText).toBe('Before the fold.');

    await toggle.click();
    await page.getByText('After the fold.', { exact: true }).click();
    await page.keyboard.press('ArrowUp');
    await expect.poll(activeText).toBe(editedTitle);
    await page.keyboard.press('ArrowDown');
    await expect.poll(activeText).toBe('After the fold.');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('retains title and range metadata when creating a fence with a keyboard', async ({ page }) => {
    await loadMarkdown(page, '');
    await focusEditor(page);
    await page.keyboard.insertText(fence);
    await page.keyboard.press('Enter');
    await expect(page.locator('.mu-code-block-title')).toHaveText('request.js');
    for (const [index, line] of body.split('\n').entries()) {
        if (index)
            await page.keyboard.press('Enter');
        if (line)
            await page.keyboard.insertText(line);
    }
    await expect.poll(() => getMarkdown(page)).toContain(`${fence}\n${body}\n`);
    await expect(page.locator('.mu-code-block .mu-code')).toHaveCSS('background-image', /linear-gradient/);
});

test('a marked logical line covers every wrapped row up to the next source line', async ({ page }) => {
    await page.setViewportSize({ width: 540, height: 720 });
    await page.evaluate(() => window.muya!.setOptions({ wrapCodeBlocks: true }));
    const markdown = ['```js {2}', 'before()', `// ${'example '.repeat(35)}`, 'after()', '```'].join('\n');
    await loadMarkdown(page, markdown);
    const code = page.locator('.mu-code-block .mu-code');

    await expect.poll(() => code.evaluate((element) => {
        const rows = [...element.parentElement!.querySelectorAll<HTMLElement>('.mu-line-numbers-rows > span')];
        const tops = rows.map(row => Number.parseFloat(row.style.top));
        const stops = [...(element as HTMLElement).style.backgroundImage.matchAll(/([\d.]+)px/g)]
            .map(match => Number(match[1]));
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
        return tops[2] - tops[1] > lineHeight && Math.abs((stops.at(-1) ?? 0) - tops[2]) < 1;
    })).toBe(true);
});
