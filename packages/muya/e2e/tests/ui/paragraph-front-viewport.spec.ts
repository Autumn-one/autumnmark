import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor, floats } from '../helpers/selectors';

async function mountScrollableHostWithHeader(page: Page, markdown: string): Promise<number> {
    return page.evaluate((md) => {
        const container = window.muya!.domNode.parentElement!;
        const header = document.createElement('div');
        header.id = 'mock-tab-bar';
        header.style.cssText = 'height: 68px; width: 100%; background: #eee; position: relative; z-index: 2;';
        container.parentElement!.insertBefore(header, container);

        container.style.height = '420px';
        container.style.overflow = 'auto';
        container.style.padding = '0';

        window.muya!.setContent(md);
        window.muya!.flush();

        return container.getBoundingClientRect().top;
    }, markdown);
}

test.describe('block hover tools stay inside the editor scrollport', () => {
    test('ParagraphFrontButton clamps inside the scrollport for tall blocks and hides when only a sliver remains', async ({ page }) => {
        const codeLines = Array.from({ length: 14 }, (_, i) => `const line${i} = ${i};`).join('\n');
        const md = `Intro paragraph\n\n\`\`\`js\n${codeLines}\n\`\`\`\n\n${Array.from({ length: 20 }, (_, i) => `Tail ${i}`).join('\n\n')}`;
        const scrollerTop = await mountScrollableHostWithHeader(page, md);

        // Scroll the code block so its top edge sits inside the 0..68px header band
        // while most of its body remains visible inside the scrollport.
        await page.evaluate(() => {
            const scroller = window.muya!.domNode.parentElement!;
            const code = document.querySelector<HTMLElement>('.mu-code-block')!;
            const scrollerRect = scroller.getBoundingClientRect();
            const codeRect = code.getBoundingClientRect();
            scroller.scrollTop += (codeRect.top - scrollerRect.top) + 30;
        });

        const codeBlock = page.locator(editor.codeBlock).first();
        const codeBox = await codeBlock.boundingBox();
        expect(codeBox).not.toBeNull();
        expect(codeBox!.y).toBeLessThan(scrollerTop);

        const visibleY = scrollerTop + 40;
        await page.mouse.move(codeBox!.x + 40, visibleY);
        await page.waitForTimeout(50);
        await page.mouse.move(codeBox!.x + 44, visibleY);

        const wrapper = page.locator(floats.paragraphFrontButton);
        await expect(wrapper).toHaveCSS('opacity', '1');

        const buttonBox = await wrapper.boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(buttonBox!.y).toBeGreaterThanOrEqual(scrollerTop - 0.5);
        expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(codeBox!.y + codeBox!.height + 0.5);

        // Clicking the clamped button still opens the paragraph menu.
        await page.locator(floats.paragraphFrontButtonInner).click();
        await expect(page.locator(floats.paragraphFrontMenu)).toBeVisible();
        await page.keyboard.press('Escape');

        // Moving the pointer onto the header hides the button immediately without waiting for throttle.
        await page.mouse.move(codeBox!.x + 40, scrollerTop - 20);
        await expect(wrapper).toHaveCSS('opacity', '0');

        // Scroll further so only a 10px sliver of the code block remains below the header.
        await page.evaluate(() => {
            const scroller = window.muya!.domNode.parentElement!;
            const code = document.querySelector<HTMLElement>('.mu-code-block')!;
            const scrollerRect = scroller.getBoundingClientRect();
            const codeRect = code.getBoundingClientRect();
            scroller.scrollTop += (codeRect.bottom - scrollerRect.top) - 10;
        });

        await page.mouse.move(codeBox!.x + 40, scrollerTop + 4);
        await page.waitForTimeout(400);
        await expect(wrapper).toHaveCSS('opacity', '0');

        // Scroll back so the same code block is fully visible again; button must recover (no wedged _status).
        await page.evaluate(() => {
            const scroller = window.muya!.domNode.parentElement!;
            const code = document.querySelector<HTMLElement>('.mu-code-block')!;
            const scrollerRect = scroller.getBoundingClientRect();
            const codeRect = code.getBoundingClientRect();
            scroller.scrollTop += (codeRect.top - scrollerRect.top) - 40;
        });
        const recoveredBox = await codeBlock.boundingBox();
        await page.mouse.move(recoveredBox!.x + 40, recoveredBox!.y + 20);
        await page.waitForTimeout(50);
        await page.mouse.move(recoveredBox!.x + 44, recoveredBox!.y + 20);
        await expect(wrapper).toHaveCSS('opacity', '1');
    });

    test('PreviewToolBar clamps inside the scrollport when a diagram top edge enters the header band', async ({ page }) => {
        const md = `Intro\n\n\`\`\`mermaid\ngraph TD\n    A[Start] --> B[Middle]\n    B --> C[Step 3]\n    C --> D[End]\n\`\`\`\n\n${Array.from({ length: 20 }, (_, i) => `After ${i}`).join('\n\n')}`;
        const scrollerTop = await mountScrollableHostWithHeader(page, md);

        await expect(page.locator(`${editor.diagramPreview} svg`).first()).toBeVisible({ timeout: 15_000 });

        await page.evaluate(() => {
            const scroller = window.muya!.domNode.parentElement!;
            const diagram = document.querySelector<HTMLElement>('.mu-diagram-block')!;
            const scrollerRect = scroller.getBoundingClientRect();
            const diagramRect = diagram.getBoundingClientRect();
            scroller.scrollTop += (diagramRect.top - scrollerRect.top) + 25;
        });

        const diagram = page.locator(editor.diagramBlock).first();
        const diagramBox = await diagram.boundingBox();
        expect(diagramBox).not.toBeNull();
        expect(diagramBox!.y).toBeLessThan(scrollerTop);

        await page.mouse.move(diagramBox!.x + diagramBox!.width / 2, scrollerTop + 40);
        await page.waitForTimeout(50);
        await page.mouse.move(diagramBox!.x + diagramBox!.width / 2 + 4, scrollerTop + 40);

        const toolbar = page.locator(floats.previewToolBar);
        await expect.poll(async () => toolbar.evaluate((el) => {
            const wrapper = el.closest('.mu-float-wrapper') as HTMLElement | null;
            return Number.parseFloat(wrapper?.style.opacity || '0');
        }), { timeout: 5_000 }).toBe(1);

        const toolbarBox = await toolbar.boundingBox();
        expect(toolbarBox).not.toBeNull();
        expect(toolbarBox!.y).toBeGreaterThanOrEqual(scrollerTop - 0.5);
        expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(diagramBox!.y + diagramBox!.height + 0.5);

        // Moving onto the header dismisses PreviewToolBar immediately.
        await page.mouse.move(diagramBox!.x + diagramBox!.width / 2, scrollerTop - 20);
        await expect.poll(async () => toolbar.evaluate((el) => {
            const wrapper = el.closest('.mu-float-wrapper') as HTMLElement | null;
            return Number.parseFloat(wrapper?.style.opacity || '0');
        })).toBe(0);
    });
});
