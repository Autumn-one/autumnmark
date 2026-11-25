import type { VNode } from 'snabbdom';
import type { Muya } from '../../index';
import type { IBaseOptions, IKeyboardShortcutOptions } from '../types';
import type {
    IQuickInsertMenuItem,
} from './config';
import Fuse from 'fuse.js';
import { replaceOp, type } from 'ot-json1';
import { canInsertLabel, replaceBlockByLabel } from '../../block/blockTransforms';
import ParagraphContent from '../../block/content/paragraphContent';
import { asDoc, asState } from '../../state';
import { deepClone } from '../../utils';
import { query } from '../../utils/dom';
import { h, patch } from '../../utils/snabbdom';
import BaseScrollFloat from '../baseScrollFloat';
import { renderMenuIcon } from '../menuIcon';
import { getShortcutHint } from '../shortcuts';
import {
    DRAWING_INSERT_ITEM,
    DRAWING_INSERT_LABEL,
    getLabelFromEvent,
    MENU_CONFIG,
} from './config';

import './index.css';

const checkQuickInsert = (text: string) => /^[/、]\S*$/.test(text);
const checkShowPlaceholder = (text: string) => /^[/、]$/.test(text);
function checkCanInsertFrontMatter(muya: Muya, block: ParagraphContent) {
    const { frontMatter } = muya.options;

    return (
        frontMatter
        && !block.parent?.prev
        && block.parent?.parent?.blockName === 'scrollpage'
    );
}

export class ParagraphQuickInsertMenu extends BaseScrollFloat {
    static pluginName = 'quickInsert';
    public override capturesContentKeydown = true;

    public oldVNode: VNode | null = null;
    private _block: ParagraphContent | null = null;
    public override activeItem: IQuickInsertMenuItem['children'][number] | null = null;
    public override renderArray: IQuickInsertMenuItem['children'] = [];
    private _renderData: IQuickInsertMenuItem[] = [];
    declare protected options: IBaseOptions & IKeyboardShortcutOptions;

    constructor(muya: Muya, options: Partial<IBaseOptions> & IKeyboardShortcutOptions = {}) {
        const name = 'mu-quick-insert';
        super(muya, name, options);
        this.renderArray = [];
        this.renderData = MENU_CONFIG;
        this.render();
        this.listen();
    }

    get renderData() {
        return this._renderData;
    }

    set renderData(data) {
        this._renderData = data;

        this.renderArray = data.flatMap(d => d.children);
        if (this.renderArray.length > 0) {
            this.activeItem = this.renderArray[0];
            const activeEle = this.getItemElement(this.activeItem);
            if (activeEle)
                this.activeEleScrollIntoView(activeEle);
        }
    }

    override listen() {
        super.listen();
        const { eventCenter, editor, domNode, i18n } = this.muya;

        eventCenter.subscribe('content-change', ({ block }) => {
            // Check weather need to show quick insert panel
            if (block.blockName !== 'paragraph.content')
                return;

            const { text, domNode } = block;
            const needToShowQuickInsert = checkQuickInsert(text);
            const needToShowPlaceholder = checkShowPlaceholder(text);
            if (needToShowPlaceholder)
                domNode!.setAttribute('placeholder', i18n.t('Search keyword...'));
            else
                domNode!.removeAttribute('placeholder');

            if (needToShowQuickInsert) {
                this._block = block;
                this.show(domNode);
                this._search(text.substring(1)); // remove `/` char
            }
            else {
                this.hide();
            }
        });

        const handleKeydown = (event: Event) => {
            const selectionResult = editor.selection.getTextSelection();
            const anchorBlock = selectionResult?.anchor.block;
            const isSelectionInSameBlock = selectionResult?.isSelectionInSameBlock;
            if (isSelectionInSameBlock && anchorBlock instanceof ParagraphContent) {
                if (anchorBlock.text)
                    return;

                const label = getLabelFromEvent(event);
                if (label) {
                    event.preventDefault();
                    replaceBlockByLabel({
                        label,
                        block: anchorBlock.parent!,
                        muya: this.muya,
                    });
                }
            }
        };

        if (this.options.keyboardShortcuts !== false)
            eventCenter.attachDOMEvent(domNode, 'keydown', handleKeydown);
        eventCenter.subscribe('shortcut-hints-change', () => {
            if (this.status)
                this.render();
        });
        eventCenter.attachDOMEvent(this.container!, 'mousemove', (event: Event) => {
            this.container!.classList.remove('mu-keyboard-navigation');
            if (!(event.target instanceof Element))
                return;

            const itemElement = event.target.closest<HTMLElement>('.item');
            if (!itemElement || !this.container!.contains(itemElement))
                return;

            const item = this.renderArray.find(({ label }) => {
                return label === itemElement.dataset.label;
            });
            if (item && item !== this.activeItem)
                this.activeItem = item;
        });
    }

    override step(direction: 'previous' | 'next') {
        this.container!.classList.add('mu-keyboard-navigation');
        super.step(direction);
    }

    override hide() {
        this.container!.classList.remove('mu-keyboard-navigation');
        super.hide();
    }

    render() {
        const { scrollElement, activeItem, renderData } = this;
        const { i18n } = this.muya;
        let children = renderData.map((section) => {
            const titleVnode = h('div.title', i18n.t(section.name).toUpperCase());
            const items = [];

            for (const item of section.children) {
                const { title, subTitle, label, icon } = item;
                const shortCut = getShortcutHint(this.options, label, item.shortCut);
                const iconVnode = h(
                    'div.icon-container',
                    renderMenuIcon({ label, icon }),
                );

                const description = h('div.description', [
                    h(
                        'div.big-title',
                        {
                            attrs: { title: `${i18n.t(title)}\n${i18n.t(subTitle)}` },
                        },
                        i18n.t(title),
                    ),
                ]);
                const shortCutVnode = shortCut ? h('div.short-cut', { attrs: { title: shortCut } }, [h('span', shortCut)]) : null;
                const selector
                    = activeItem!.label === label ? 'div.item.active' : 'div.item';
                items.push(
                    h(
                        selector,
                        {
                            dataset: { label },
                            on: {
                                click: () => {
                                    this.selectItem(item);
                                },
                            },
                        },
                        [iconVnode, description, shortCutVnode],
                    ),
                );
            }

            return h('section', [titleVnode, ...items]);
        });

        if (children.length === 0)
            children = [h('div.no-result', i18n.t('No result'))];

        const vnode = h('div', children);

        if (this.oldVNode)
            patch(this.oldVNode, vnode);
        else
            patch(scrollElement!, vnode);

        this.oldVNode = vnode;
    }

    private _search(text: string) {
        const { muya, _block: block } = this;
        const { i18n } = muya;
        const canInsertFrontMatter = checkCanInsertFrontMatter(muya, block!);
        const menuConfig = deepClone(MENU_CONFIG);
        const drawing = muya.options.embeddedDrawing?.quickInsert;
        if (drawing) {
            menuConfig.find(menu => menu.name === 'diagrams')?.children.push({
                ...DRAWING_INSERT_ITEM,
                title: drawing.title(),
            });
        }

        if (!canInsertFrontMatter) {
            menuConfig
                .find(menu => menu.name === 'basic blocks')
                ?.children
                .splice(2, 1);
        }

        for (const menu of menuConfig) {
            menu.children = menu.children.filter(({ label }) => {
                if (!canInsertLabel(label, muya))
                    return false;
                return !(label.startsWith('github-alert ') || label === 'content-tabs' || label === 'fold-block') || block?.parent?.parent?.isScrollPage;
            });
        }
        const availableMenus = menuConfig.filter(menu => menu.children.length);
        let result = availableMenus;
        if (text !== '') {
            result = [];

            for (const menu of availableMenus) {
                for (const child of menu.children) {
                    child.i18nTitle = i18n.t(child.title);
                    child.searchText = i18n.t(child.subTitle);
                }

                const fuse = new Fuse(menu.children, {
                    includeScore: true,
                    keys: ['i18nTitle', 'title', 'searchText'],
                });
                const match = fuse
                    .search(text)
                    .map(i => ({ score: i.score, ...i.item }));
                if (match.length) {
                    result.push({
                        name: menu.name,
                        children: match,
                    });
                }
            }

            if (result.length) {
                result.sort((a, b) => {
                    return a.children[0].score! < b.children[0].score! ? -1 : 1;
                });
            }
        }
        this.renderData = result;
        this.render();
    }

    override selectItem({ label }: IQuickInsertMenuItem['children'][number]) {
        const { _block: block, muya } = this;
        if (block?.outMostBlock) {
            if (label === DRAWING_INSERT_LABEL)
                this._insertDrawing(block);
            else
                replaceBlockByLabel({ label, block: block.parent!, muya });
        }
        // delay hide to avoid dispatch enter handler
        setTimeout(this.hide.bind(this));
    }

    private _insertDrawing(block: ParagraphContent) {
        const { muya } = this;
        const insert = muya.options.embeddedDrawing?.quickInsert?.open;
        muya.flush();
        const paragraph = block.parent;
        if (!insert || muya.isReadOnly || !paragraph || !muya.isBlockInDocument(block) || !checkQuickInsert(block.text))
            return;
        const { jsonState } = muya.editor;
        const snapshot = jsonState.rawState;
        const path = paragraph.path;
        const previous = paragraph.getState();
        const embeddedIndex = [...muya.domNode.querySelectorAll('.mu-embedded-drawing, .mu-inline-drawing')].filter(preview =>
            preview.compareDocumentPosition(paragraph.domNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).length;
        insert({
            markdown: jsonState.getMarkdown(),
            embeddedIndex,
            replace: (markup) => {
                const [replacement] = jsonState.markdownToState(markup);
                const op = replaceOp(path, asDoc(previous), asDoc(replacement));
                return jsonState.getMarkdownFromState(asState(type.apply(asDoc(snapshot), op)));
            },
        });
    }

    getItemElement(item: IQuickInsertMenuItem['children'][number]) {
        const { label } = item;

        return query<HTMLElement>(`[data-label="${label}"]`, this.scrollElement!);
    }
}
