import { h } from '../dom';

let timer = 0;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.body.append(el);
  clearTimeout(timer);
  timer = window.setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3000);
}
