import { describe, expect, it } from 'vitest';
import { contentTabHeading, contentTabsMarker, findContentTabGroups } from '../contentTabs';

describe('content tabs syntax', () => {
    it.each(['#### | Alpha', '# \\| Alpha', '  ##\t|\tAlpha ###  '])('recognizes the heading marker in %j', (source) => {
        expect(contentTabHeading(source)?.label).toBe('Alpha');
    });

    it.each(['#### |Alpha', '#### || Alpha', '#### Ordinary | heading', '#### \\\\| Alpha', '| Alpha', '#### **| Alpha**'])('keeps ordinary text in %j', (source) => {
        expect(contentTabHeading(source)).toBeUndefined();
    });

    it.each([['#### | ', ''], ['#### | C#', 'C#'], ['#### | \\#', '\\#'], ['#### | Alpha # #', 'Alpha #']])('keeps the title body of %j', (source, label) => {
        expect(contentTabHeading(source)?.label).toBe(label);
    });

    it('requires a standalone, complete comment', () => {
        expect(contentTabsMarker('<!-- tabs -->\n')).toBe('start');
        expect(contentTabsMarker('  <!--/tabs-->  ')).toBe('end');
        for (const source of ['<!-- tabs --> extra', '<!-- tabs -->\ntext', '<!-- tabs', '<!-- tabs --><!-- /tabs -->'])
            expect(contentTabsMarker(source)).toBeUndefined();
    });

    it('does not publish nested groups while an outer boundary is incomplete', () => {
        expect(findContentTabGroups([
            { marker: 'start' },
            { heading: contentTabHeading('## | A') },
            { marker: 'start' },
            { heading: contentTabHeading('## | B') },
            { marker: 'end' },
        ])).toEqual([]);
    });
});
