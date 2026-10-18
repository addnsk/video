import { h } from '../dom';

export abstract class Panel {
  readonly element: HTMLElement;
  protected body: HTMLDivElement;

  protected constructor(id: string, title: string) {
    this.body = h('div', { class: 'group' });
    this.element = h('section', { class: 'panel', id }, h('h2', {}, title), this.body);
  }
}
