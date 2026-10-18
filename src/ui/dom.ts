type Props = Record<string, unknown> & { class?: string; style?: string; dataset?: Record<string, string> };
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

export const formatTimecode = (seconds: number, fps: number): string => {
  const s = Math.max(0, seconds) + 1e-6;
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = Math.round(fps) || 25;
  const frames = Math.min(base - 1, Math.floor((s % 1) * base));
  const total = Math.floor(s);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(frames)}`;
};

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
