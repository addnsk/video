import { t } from '../i18n';
import { h } from './dom';

export class PointPicker {
  private pending: ((point: { x: number; y: number } | null) => void) | null = null;
  private layer: HTMLDivElement;

  constructor(
    private screen: HTMLElement,
    private aspect: () => number,
  ) {
    this.layer = h('div', { class: 'point-picker', id: 'point-picker', hidden: true }, h('span', {}, t('trackPick')));
    this.layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.finish(this.toFrame(e.clientX, e.clientY));
    });
    window.addEventListener('keydown', (e) => {
      if (this.pending && e.key === 'Escape') this.finish(null);
    });
    screen.append(this.layer);
  }

  pick(): Promise<{ x: number; y: number } | null> {
    this.finish(null);
    this.layer.hidden = false;
    return new Promise((resolve) => (this.pending = resolve));
  }

  private finish(point: { x: number; y: number } | null) {
    const resolve = this.pending;
    this.pending = null;
    this.layer.hidden = true;
    resolve?.(point);
  }

  private toFrame(clientX: number, clientY: number) {
    const r = this.screen.getBoundingClientRect();
    const aspect = this.aspect();
    const w = r.width / r.height > aspect ? r.height * aspect : r.width;
    const hgt = r.width / r.height > aspect ? r.height : r.width / aspect;
    return { x: (clientX - r.left - (r.width - w) / 2) / w - 0.5, y: (clientY - r.top - (r.height - hgt) / 2) / hgt - 0.5 };
  }
}
