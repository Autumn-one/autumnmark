import type { Nullable } from '../../../types';
import type { ILinkedNode } from './linkedNode';

export class LinkedList<T extends ILinkedNode> {
    head: Nullable<T> = null;

    tail: Nullable<T> = null;

    length: number = 0;

    // Caret paths need both directions repeatedly between changes to sibling order.
    private _index?: { nodes: T[]; offsets: Map<T, number> };

    private _getIndex() {
        if (!this._index) {
            const nodes = [...this.iterator()];
            const offsets = new Map<T, number>();
            nodes.forEach((node, i) => offsets.set(node, i));
            this._index = { nodes, offsets };
        }
        return this._index;
    }

    * iterator(curNode = this.head, length = this.length) {
        let count = 0;

        while (count < length && curNode) {
            yield curNode;
            count++;
            curNode = curNode.next as T;
        }
    }

    append(...nodes: T[]) {
        for (const node of nodes)
            this.insertBefore(node);
    }

    contains(node: T) {
        return this.offset(node) !== -1;
    }

    insertBefore(node: T, refNode: T | null = null) {
        if (!node)
            return;
        node.next = refNode;
        if (refNode !== null) {
            node.prev = refNode.prev;
            if (refNode.prev != null)
                refNode.prev.next = node;

            refNode.prev = node;
            if (this.head === refNode)
                this.head = node;
        }
        else if (this.tail != null) {
            this.tail.next = node;
            node.prev = this.tail;
            this.tail = node;
        }
        else {
            node.prev = null;
            this.head = this.tail = node;
        }
        this.length += 1;
        this._index = undefined;
    }

    offset(node: T) {
        if (node === this.head)
            return 0;
        if (node === this.tail)
            return this.length - 1;
        return this._getIndex().offsets.get(node) ?? -1;
    }

    remove(node: T) {
        if (!this.contains(node))
            return;
        if (node.prev)
            node.prev.next = node.next;

        if (node.next)
            node.next.prev = node.prev;

        if (this.head === node)
            this.head = node.next as T;

        if (this.tail === node)
            this.tail = node.prev as T;

        this.length -= 1;
        this._index = undefined;
    }

    find(index: number) {
        if (index < 0 || index >= this.length)
            return null;

        if (index === 0)
            return this.head;
        if (index === this.length - 1)
            return this.tail;
        return this._getIndex().nodes[index];
    }

    forEach(callback: (cur: T, i: number) => void) {
        return [...this.iterator()].forEach(callback);
    }

    forEachAt(
        index: number,
        length: number = this.length,
        callback: (cur: T, i: number) => void,
    ) {
        const curNode = this.find(index);

        return [...this.iterator(curNode, length)].forEach((node, i) => {
            callback(node, i + index);
        });
    }

    map<M>(callback: (cur: T, i: number) => M): M[] {
        return [...this.iterator()].map((node, i) => callback(node, i));
    }

    reduce<M>(callback: (memo: M, cur: T, i: number) => M, memo: M): M {
        return [...this.iterator()].reduce(callback, memo);
    }
}
