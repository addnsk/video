import type { DropPoint } from '../drop-target';
import { h } from '../dom';

export interface DragHandlers {
  label(): string;
  move(point: DropPoint): boolean;
  drop(point: DropPoint): void;
  cancel(): void;
}

const THRESHOLD_PX = 6;

export function dragSource(element: HTMLElement, handle: HTMLElement, handlers: DragHandlers): void {
  const start = (e: PointerEvent, immediate: boolean) => {
    if (e.button !== 0) return;
    const origin = { x: e.clientX, y: e.clientY };
    let ghost: HTMLElement | null = null;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const place = (p: PointerEvent, accepted: boolean) => {
      ghost!.style.transform = `translate(${p.clientX + 12}px, ${p.clientY + 12}px)`;
      ghost!.classList.toggle('accepted', accepted);
    };
    const begin = () => {
      ghost = h('div', { class: 'drag-ghost' }, handlers.label());
      document.body.append(ghost);
      document.body.classList.add('dragging');
    };
    const move = (p: PointerEvent) => {
      if (!ghost) {
        if (!immediate && Math.hypot(p.clientX - origin.x, p.clientY - origin.y) < THRESHOLD_PX) return;
        begin();
      }
      place(p, handlers.move(p));
    };
    const finish = (p: PointerEvent, commit: boolean) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      ghost.remove();
      document.body.classList.remove('dragging');
      if (commit) handlers.drop(p);
      else handlers.cancel();
    };
    const up = (p: PointerEvent) => finish(p, true);
    const cancel = (p: PointerEvent) => finish(p, false);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    if (immediate) e.preventDefault();
  };
  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button, input, select')) return;
    start(e, false);
  });
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    start(e, true);
  });
}
