import type { Muya } from '../../../muya';
import type { ITableState } from '../../../state/types';
import type TableRow from './row';
import { mixins } from '../../../utils';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class TableInner extends Parent {
    override children: LinkedList<TableRow> = new LinkedList();

    static override blockName = 'table.inner';

    static create(muya: Muya, state: ITableState) {
        const table = new TableInner(muya, state);

        table.append(
            ...state.children.map(child =>
                ScrollPage.loadBlock('table.row').create(muya, child),
            ),
        );
        table.updateMinWidth();
        return table;
    }

    override get path() {
        return [...this.parent!.path, 'children'];
    }

    constructor(muya: Muya, _state: ITableState) {
        super(muya);
        this.tagName = 'table';

        this.classList = ['mu-table-inner'];
        this.createDomNode();
    }

    updateMinWidth(widths = this.children.head?.children.map(cell => cell.meta.width) ?? []) {
        const style = this.domNode!.style;
        if (!widths.length || !widths.every(width => typeof width === 'number')) {
            style.minWidth = '';
            return;
        }
        // A narrow viewport can compress pixel widths down to the same scrolling threshold as an automatic table.
        const total = widths.reduce((sum, width) => sum + width, 0);
        style.minWidth = `min(${total}px, calc(${widths.length} * var(--mu-cell-auto-min-width)))`;
    }

    override getState(): ITableState {
        const state: ITableState = {
            name: 'table',
            children: this.map(node => (node as TableRow).getState()),
        };

        return state;
    }
}

export default TableInner;
