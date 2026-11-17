import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { lineEndKey, lineStartKey, loadMarkdown, metaKey } from '../helpers/keyboard';
import { editor, toolbar } from '../helpers/selectors';

const source = '<!-- tabs -->\n\n#### | Alpha\n\nFirst body.\n\n#### \\| Beta\n\nSecond body.\n\n#### Ordinary\n\nStill in Beta.\n\n<!-- /tabs -->\n\nOutside.\n';
const titleInput = '.mu-content-tabs-list input';

test('switches tabs, edits content, and keeps edits through undo and source reload', async ({ page }) => {
    await loadMarkdown(page, source);
    await expect(page.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(editor.paragraph).filter({ hasText: 'First body.' })).toBeVisible();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body.' })).toBeHidden();
    await page.getByRole('tab', { name: 'Beta' }).click();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'First body.' })).toBeHidden();
    await expect(page.locator(editor.atxHeading).filter({ hasText: 'Ordinary' })).toBeVisible();
    expect(await getMarkdown(page)).toBe(source);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(lineEndKey());
    await page.keyboard.type(' Changed');
    await expect.poll(() => getMarkdown(page)).toContain('Second body. Changed');
    await page.locator(toolbar.undo).click();
    await expect.poll(() => getMarkdown(page)).toBe(source);
    await page.locator(toolbar.redo).click();
    const edited = await getMarkdown(page);
    expect(edited).toContain('Second body. Changed');
    await loadMarkdown(page, edited);
    await page.getByRole('tab', { name: 'Beta' }).click();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body. Changed' })).toBeVisible();
});

test('edits labels with a double click and navigates tabs using the keyboard', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('tab', { name: 'Alpha' }).dblclick();
    await expect(page.locator(titleInput)).toBeFocused();
    await expect(page.locator(editor.atxHeading).filter({ hasText: 'Alpha' })).toBeHidden();
    await page.keyboard.press(lineEndKey());
    await page.keyboard.type(' renamed');
    await expect(page.locator(titleInput)).toHaveValue('Alpha renamed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Alpha renamed' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('F2');
    await page.keyboard.type('Linux');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Linux' })).toBeFocused();
    await expect.poll(() => getMarkdown(page)).toContain('#### \\| Linux');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Alpha renamed' })).toHaveAttribute('aria-selected', 'true');
});

test('exposes boundaries in local source view and all panels when printing', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('button', { name: 'Edit tabs source' }).click();
    await expect(page.locator('.mu-content-tabs-boundary .mu-html-container').first()).toBeVisible();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body.' })).toBeVisible();
    await page.getByRole('tab', { name: 'Alpha' }).click();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body.' })).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.mu-content-tabs-bar')).toBeHidden();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'First body.' })).toBeVisible();
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body.' })).toBeVisible();
    await expect(page.locator('.mu-content-tabs-boundary').first()).toBeHidden();
});

test('find reveals a match inside an inactive tab', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.locator(toolbar.search).fill('Second body');
    await expect(page.locator(editor.paragraph).filter({ hasText: 'Second body.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
});

test('quick insert creates a complete group in one undo step', async ({ page }) => {
    await loadMarkdown(page, '');
    await page.locator(editor.paragraph).click();
    await page.keyboard.type('/tabs', { delay: 40 });
    await expect(page.locator('.mu-quick-insert [data-label="content-tabs"]')).toBeVisible();
    await page.locator('.mu-quick-insert [data-label="content-tabs"]').click();
    await expect(page.locator('[role="tab"]')).toHaveCount(2);
    await expect(page.locator(titleInput)).toBeFocused();
    await expect(page.locator('.mu-content-tab-title').first()).toBeHidden();
    await expect.poll(() => getMarkdown(page)).toContain('<!-- /tabs -->');
    await page.locator(toolbar.undo).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect.poll(() => getMarkdown(page)).toContain('/tabs');
});

test('quick insert selects the first title and Enter finishes editing in the existing body', async ({ page }) => {
    await loadMarkdown(page, '');
    await page.locator(editor.paragraph).click();
    await page.keyboard.type('/tabs', { delay: 40 });
    await expect(page.locator('.mu-quick-insert [data-label="content-tabs"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('First title');
    await expect(page.locator(titleInput)).toHaveValue('First title');
    const before = await getMarkdown(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.mu-content-tab-title').first()).toBeHidden();
    expect(await getMarkdown(page)).toBe(before);
    await page.keyboard.type('First body');
    await expect(page.locator(editor.paragraph).filter({ hasText: 'First body' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'First title' })).toHaveAttribute('aria-selected', 'true');
});

test('Up places a caret in the active title and Down returns to the same position in the body', async ({ page }) => {
    await loadMarkdown(page, source);
    const beta = page.getByRole('tab', { name: 'Beta' });
    await beta.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const input = page.locator(titleInput);
    await expect(input).toBeFocused();
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart === el.selectionEnd)).toBe(true);
    expect(await getMarkdown(page)).toBe(source);
    await page.keyboard.press(lineEndKey());
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    await expect(input).toHaveValue('BetXa');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveCount(0);
    await page.keyboard.type('!');
    await expect.poll(() => getMarkdown(page)).toBe(source.replace('Beta', 'BetXa').replace('Second body.', 'Se!cond body.'));
});

test('Up moves through wrapped lines and paragraphs before entering the title', async ({ page }) => {
    await loadMarkdown(page, source.replace('First body.', `${'wrapped body '.repeat(18)}end\n\nSecond paragraph.`));
    const first = page.locator(editor.paragraph).filter({ hasText: 'wrapped body' });
    await first.evaluate(el => el.style.width = '230px');
    await page.locator(editor.paragraph).filter({ hasText: 'Second paragraph.' }).click();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(titleInput)).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(titleInput)).toHaveCount(0);
    for (let i = 0; i < 20 && await page.locator(titleInput).count() === 0; i++)
        await page.keyboard.press('ArrowUp');
    await expect(page.locator(titleInput)).toBeFocused();
    await expect(page.locator(titleInput)).toHaveValue('Alpha');
});

test('chooses the innermost active title and preserves its Markdown through undo and redo', async ({ page }) => {
    const nested = source.replace('First body.', '<!-- tabs -->\n\n### \\| **Inner** ###\n\nInside\n\n<!-- /tabs -->');
    await loadMarkdown(page, nested);
    await page.locator(editor.paragraph).filter({ hasText: 'Inside' }).click();
    await page.keyboard.press('ArrowUp');
    const input = page.locator(titleInput);
    await expect(input).toHaveValue('**Inner**');
    await page.keyboard.press(`${metaKey()}+a`);
    await page.keyboard.type('Name');
    await expect.poll(() => getMarkdown(page)).toBe(nested.replace('**Inner**', 'Name'));
    await page.keyboard.press(`${metaKey()}+z`);
    await expect(input).toHaveValue('**Inner**');
    await page.keyboard.press(`${metaKey()}+Shift+z`);
    await expect(input).toHaveValue('Name');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Name' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
});

test('lets the IME own candidate keys and finishes the title after composition', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('tab', { name: 'Alpha' }).dblclick();
    const input = page.locator(titleInput);
    await input.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.value = '标题';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        for (const key of ['Enter', 'ArrowDown', 'Escape'])
            el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: true }));
    });
    await expect(input).toBeFocused();
    expect(await getMarkdown(page)).toBe(source);
    await input.dispatchEvent('compositionend', { data: '标题' });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: '标题' })).toBeVisible();
    await expect.poll(() => getMarkdown(page)).toBe(source.replace('Alpha', '标题'));
});

test('returns to an empty panel without adding a paragraph', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('button', { name: 'Add tab' }).click();
    const before = await getMarkdown(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(titleInput)).toHaveValue('Tab 3');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(titleInput)).toHaveCount(0);
    expect(await getMarkdown(page)).toBe(before);
    await page.keyboard.insertText('正文');
    await expect.poll(() => getMarkdown(page)).toContain('#### | Tab 3\n\n正文');
});

test('returns from the inline title to the same table header cell', async ({ page }) => {
    await loadMarkdown(page, source.replace('First body.', '| First | Second |\n| --- | --- |\n| a | b |'));
    const header = page.locator(editor.tableCell).filter({ hasText: 'Second' });
    await header.click();
    await page.keyboard.press(lineEndKey());
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(titleInput)).toHaveValue('Alpha');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('!');
    await expect(header).toHaveText('Second!');
});

test('finishes title editing when clicking body or pressing Escape', async ({ page }) => {
    await loadMarkdown(page, source);
    const heading = page.locator(titleInput);
    await page.getByRole('tab', { name: 'Alpha' }).dblclick();
    await page.keyboard.press(lineEndKey());
    await page.keyboard.type(' renamed');
    await page.locator(editor.paragraph).filter({ hasText: 'First body.' }).click();
    await expect(heading).toBeHidden();
    await page.getByRole('tab', { name: 'Alpha renamed' }).dblclick();
    await expect(heading).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(heading).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Alpha renamed' })).toBeFocused();
    await page.getByRole('tab', { name: 'Alpha renamed' }).dblclick();
    await page.locator(toolbar.search).click();
    await expect(heading).toBeHidden();
});

test('adds a tab from the bar and edits its title and body', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('button', { name: 'Add tab' }).click();
    await expect(page.locator('[role="tab"]')).toHaveCount(3);
    await expect(page.locator(titleInput)).toHaveValue('Tab 3');
    await page.keyboard.type('Linux');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mu-content-tab-title').last()).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Linux' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.type('Linux body');
    await expect.poll(() => getMarkdown(page)).toContain('#### | Linux\n\nLinux body\n\n<!-- /tabs -->');
});

test('hides the add button in read-only mode', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.getByRole('tab', { name: 'Alpha' }).dblclick();
    await page.evaluate(() => window.muya!.setReadOnly(true));
    await expect(page.locator(titleInput)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add tab' })).toBeHidden();
    await page.getByRole('tab', { name: 'Beta' }).click();
    await expect(page.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('F2');
    await expect(page.locator(titleInput)).toHaveCount(0);
    await page.evaluate(() => window.muya!.setReadOnly(false));
    await expect(page.getByRole('button', { name: 'Add tab' })).toBeVisible();
});

test('an enclosing heading fold hides the tab controls too', async ({ page }) => {
    await loadMarkdown(page, `# Section\n\n${source}`);
    await page.locator(editor.foldToggle).first().click();
    await expect(page.locator('.mu-content-tabs-bar')).toBeHidden();
    await page.locator(editor.foldToggle).first().click();
    await expect(page.getByRole('tab', { name: 'Alpha' })).toBeVisible();
});

for (const key of ['Backspace', 'Delete']) {
    test(`${key} at a panel boundary reveals hidden source before editing it`, async ({ page }) => {
        await loadMarkdown(page, source);
        await page.getByRole('tab', { name: 'Alpha' }).click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(key === 'Backspace' ? lineStartKey() : lineEndKey());
        await page.keyboard.press(key);
        expect(await getMarkdown(page)).toBe(source);
        const title = key === 'Backspace' ? 'Alpha' : 'Beta';
        await expect(page.locator(editor.atxHeading).filter({ hasText: title })).toBeVisible();
    });
}

test('select all and deletion include hidden panels and undo restores the complete document', async ({ page }) => {
    await loadMarkdown(page, source);
    await page.locator(editor.paragraph).filter({ hasText: 'First body.' }).click();
    await page.keyboard.press(`${metaKey()}+a`);
    await page.keyboard.press(`${metaKey()}+a`);
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await getMarkdown(page)).trim()).toBe('');
    await page.locator(toolbar.undo).click();
    await expect.poll(() => getMarkdown(page)).toBe(source);
    await expect(page.getByRole('tab')).toHaveCount(2);
});
