// @vitest-environment happy-dom

import { expect, it } from 'vitest';
import { bootMuya, useMuyaHarness } from './muyaHarness';

useMuyaHarness();

it('discards text outside document blocks when opening another document', () => {
    const muya = bootMuya('First document\n');
    const container = muya.editor.scrollPage!.domNode!;
    container.prepend('s');

    const markdown = '# Next document\n\ns\n';
    muya.setContent(markdown);

    expect(Array.from(container.childNodes, node => node.nodeName)).toEqual(['H1', 'P']);
    expect(container.lastChild?.textContent).toBe('s');
    expect(muya.getMarkdown()).toBe(markdown);
});
