import { h } from '../dom';

export abstract class Panel {
  readonly element: HTMLElement;
  protected body: HTMLDivElement;
  private queued = false;

  protected constructor(id: string, title: string) {
    this.body = h('div', { class: 'group' });
    this.element = h('section', { class: 'panel', id }, h('h2', {}, title), this.body);
  }

  protected render(): void {}

  protected schedule(): void {
    if (this.queued) return;
    this.queued = true;
    const run = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && this.element.contains(active) && active.matches('input, select, textarea')) {
        this.element.addEventListener('focusout', () => requestAnimationFrame(run), { once: true });
        return;
      }
      this.queued = false;
      this.render();
    };
    requestAnimationFrame(run);
  }
}
