import { h } from '../dom';

export class Modal {
  readonly card: HTMLDivElement;
  private root: HTMLDivElement;

  constructor(title: string) {
    const heading = h('h3', { id: 'modal-title' }, title);
    this.card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' }, heading);
    this.root = h('div', { class: 'modal' }, this.card);
    document.body.append(this.root);
  }

  body(...nodes: Node[]): void {
    const heading = this.card.firstElementChild!;
    this.card.replaceChildren(heading, ...nodes);
  }

  title(text: string): void {
    this.card.firstElementChild!.textContent = text;
  }

  close(): void {
    this.root.remove();
  }
}
