import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../i18n';
import type { Strings } from '../../i18n/en';
import { iconPath, type IconName } from '../icons';

export type PageId = 'edit' | 'fusion' | 'color' | 'fairlight' | 'deliver';

export interface WorkspaceParts {
  readonly bar: HTMLElement;
  readonly viewer: HTMLElement;
  readonly timeline: HTMLElement;
  readonly panels: Readonly<Record<string, HTMLElement>>;
  readonly onPage: (page: PageId) => void;
}

export interface WorkspaceHandle {
  reveal(panel: string): void;
}

interface PageLayout {
  readonly label: keyof Strings;
  readonly icon: IconName;
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly rightWidth?: number;
}

export const PAGES: Readonly<Record<PageId, PageLayout>> = {
  edit: { icon: 'film', label: 'pageEdit', left: ['media', 'library', 'markers', 'subtitles'], right: ['item', 'transition', 'color', 'scopes', 'mixer', 'stills', 'script'] },
  fusion: { icon: 'nodes', label: 'pageFusion', left: ['library', 'media'], right: ['item', 'scopes', 'script'] },
  color: { icon: 'palette', label: 'pageColor', left: ['stills', 'library'], right: ['color', 'scopes', 'item'] },
  fairlight: { icon: 'sliders', label: 'pageFairlight', left: ['media', 'library'], right: ['mixer', 'item'], rightWidth: 560 },
  deliver: { icon: 'send', label: 'pageDeliver', left: ['deliver'], right: ['subtitles'] },
};

const PAGE_ORDER: readonly PageId[] = ['edit', 'fusion', 'color', 'fairlight', 'deliver'];
const PHONE_QUERY = '(max-width: 599px), (max-height: 499px)';

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatch(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return match;
}

const PANEL_ICONS: Readonly<Record<string, IconName>> = {
  media: 'folder', library: 'wand', markers: 'marker', subtitles: 'text', item: 'sliders', transition: 'layers', scopes: 'compare',
  color: 'palette', stills: 'layers', mixer: 'audio', script: 'sparkle', deliver: 'send',
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className={`icon icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconPath(name) }} />;
}

function Slot({ element, className }: { element: HTMLElement; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current!.append(element);
  }, [element]);
  return <div ref={host} className={className ?? 'slot'} />;
}

function Parking({ elements }: { elements: readonly HTMLElement[] }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const el of elements) if (!el.isConnected || el.closest('.parking')) host.current!.append(el);
  });
  return <div ref={host} className="parking" hidden />;
}

interface SplitProps {
  readonly id: string;
  readonly direction: 'row' | 'column';
  readonly initial: number;
  readonly min: number;
  readonly max: number;
  readonly side: 'start' | 'end';
  readonly children: [ReactNode, ReactNode];
}

function Split({ id, direction, initial, min, max, side, children }: SplitProps) {
  const [size, setSize] = useState(() => stored(`montage.split.${id}`, initial));
  const box = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const pos = direction === 'row' ? ev.clientX - rect.left : ev.clientY - rect.top;
      const total = direction === 'row' ? rect.width : rect.height;
      setSize(clamp(side === 'start' ? pos : total - pos));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      setSize((v) => (remember(`montage.split.${id}`, v), v));
      window.dispatchEvent(new Event('resize'));
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const grow = side === 'start' ? 1 : -1;
    const delta = e.key === (direction === 'row' ? 'ArrowRight' : 'ArrowDown') ? step * grow : e.key === (direction === 'row' ? 'ArrowLeft' : 'ArrowUp') ? -step * grow : 0;
    if (!delta) return;
    e.preventDefault();
    setSize((v) => {
      const next = clamp(v + delta);
      remember(`montage.split.${id}`, next);
      return next;
    });
  };
  const reset = () => {
    setSize(initial);
    remember(`montage.split.${id}`, initial);
  };
  const fixed = { flex: `0 0 ${size}px` };
  const [a, b] = children;
  return (
    <div ref={box} className={`split split-${direction}`} data-split={id}>
      <div className="split-pane" style={side === 'start' ? fixed : undefined}>{a}</div>
      <div
        className="splitter"
        role="separator"
        aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={start}
        onKeyDown={key}
        onDoubleClick={reset}
      />
      <div className="split-pane" style={side === 'end' ? fixed : undefined}>{b}</div>
    </div>
  );
}

function panelTitle(element: HTMLElement, key: string): string {
  return element.querySelector(':scope > h2, :scope > summary')?.textContent ?? key;
}

function Column({ id, keys, panels, active, onActive }: { id: string; keys: readonly string[]; panels: WorkspaceParts['panels']; active: string; onActive: (key: string) => void }) {
  const shown = keys.filter((k) => panels[k]);
  const current = shown.includes(active) ? active : shown[0];
  useLayoutEffect(() => {
    const element = panels[current];
    if (element instanceof HTMLDetailsElement) element.open = true;
    window.dispatchEvent(new Event('resize'));
  }, [current, panels]);
  return (
    <aside className="inspector column" data-column={id}>
      <div className="column-tabs" role="tablist">
        {shown.map((k) => (
          <button key={k} type="button" role="tab" className="column-tab" data-panel={k} aria-selected={k === current} title={panelTitle(panels[k], k)} aria-label={panelTitle(panels[k], k)} onClick={() => onActive(k)}>
            <Icon name={PANEL_ICONS[k] ?? 'more'} size={17} />
            {k === current && <span>{panelTitle(panels[k], k)}</span>}
          </button>
        ))}
      </div>
      {current && <Slot key={current} element={panels[current]} className="column-body" />}
    </aside>
  );
}

function PageBar({ page, onPage }: { page: PageId; onPage: (page: PageId) => void }) {
  return (
    <nav className="page-bar" role="tablist" aria-label={t('pages')}>
      {PAGE_ORDER.map((id) => (
        <button key={id} id={`page-${id}`} role="tab" aria-selected={id === page} className="page-tab" onClick={() => onPage(id)}>
          <Icon name={PAGES[id].icon} size={18} />
          <span>{t(PAGES[id].label)}</span>
        </button>
      ))}
    </nav>
  );
}

export type LayoutMode = 'wide' | 'classic';
export const LAYOUT_KEY = 'montage.layout';
export const LAYOUT_EVENT = 'montage-layout';

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => stored(LAYOUT_KEY, 'wide'));
  useEffect(() => {
    const update = () => setMode(stored(LAYOUT_KEY, 'wide'));
    window.addEventListener(LAYOUT_EVENT, update);
    return () => window.removeEventListener(LAYOUT_EVENT, update);
  }, []);
  return mode;
}

function Desktop({ parts, page, active, onActive }: { parts: WorkspaceParts; page: PageId; active: Record<string, string>; onActive: (column: string, key: string) => void }) {
  const layout = PAGES[page];
  const mode = useLayoutMode();
  const column = (side: 'left' | 'right') => (
    <Column id={`${page}.${side}`} keys={layout[side]} panels={parts.panels} active={active[`${page}.${side}`] ?? ''} onActive={(k) => onActive(`${page}.${side}`, k)} />
  );
  const sides = (middle: ReactNode, tag: string) => {
    const withRight = layout.right.length ? (
      <Split id={`${page}.${tag}.right`} direction="row" initial={layout.rightWidth ?? 300} min={220} max={900} side="end">
        {middle}
        {column('right')}
      </Split>
    ) : middle;
    return layout.left.length ? (
      <Split id={`${page}.${tag}.left`} direction="row" initial={260} min={180} max={520} side="start">
        {column('left')}
        {withRight}
      </Split>
    ) : withRight;
  };
  const viewer = <Slot element={parts.viewer} className="viewer-slot" />;
  const timeline = <Slot element={parts.timeline} className="timeline-slot" />;
  if (mode === 'classic') {
    return sides(
      <Split id={`${page}.rows`} direction="column" initial={Math.round(innerHeight * 0.36)} min={120} max={Math.round(innerHeight * 0.75)} side="end">
        {viewer}
        {timeline}
      </Split>,
      'classic',
    );
  }
  return (
    <Split id={`${page}.wide.rows`} direction="column" initial={Math.round(innerHeight * 0.4)} min={140} max={Math.round(innerHeight * 0.75)} side="end">
      {sides(viewer, 'wide')}
      {timeline}
    </Split>
  );
}

function Phone({ parts, page, request }: { parts: WorkspaceParts; page: PageId; request: string | null }) {
  const [sheet, setSheet] = useState<string | null>(null);
  useEffect(() => setSheet(request), [request]);
  const [full, setFull] = useState(false);
  const keys = [...PAGES[page].left, ...PAGES[page].right].filter((k) => parts.panels[k]);
  useEffect(() => setSheet(null), [page]);
  return (
    <div className="phone-body">
      <Slot element={parts.viewer} className="viewer-slot" />
      <Slot element={parts.timeline} className="timeline-slot" />
      <div className="tool-strip" role="toolbar">
        {keys.map((k) => (
          <button key={k} className="tool-chip" data-sheet={k} aria-pressed={sheet === k} onClick={() => setSheet(sheet === k ? null : k)}>
            <Icon name={PANEL_ICONS[k] ?? 'more'} />
            <span>{panelTitle(parts.panels[k], k)}</span>
          </button>
        ))}
      </div>
      {sheet && (
        <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-label={panelTitle(parts.panels[sheet], sheet)}>
          <div className="sheet-head">
            <button className="sheet-grip" aria-label={t('sheetResize')} onClick={() => setFull(!full)} />
            <button className="btn small" onClick={() => setSheet(null)} aria-label={t('close')}>×</button>
          </div>
          <Slot key={sheet} element={parts.panels[sheet]} className="sheet-body" />
        </div>
      )}
    </div>
  );
}

function Workspace({ parts, handle }: { parts: WorkspaceParts; handle: { reveal?: (panel: string) => void } }) {
  const phone = useMedia(PHONE_QUERY);
  const [page, setPage] = useState<PageId>(() => stored('montage.page', 'edit'));
  const [active, setActive] = useState<Record<string, string>>(() => stored('montage.columns', {}));
  const [request, setRequest] = useState<string | null>(null);
  const choose = (next: PageId) => {
    setPage(next);
    remember('montage.page', next);
  };
  const activate = (column: string, key: string) => {
    setActive((prev) => {
      const next = { ...prev, [column]: key };
      remember('montage.columns', next);
      return next;
    });
  };
  handle.reveal = (panel: string) => {
    const target = PAGES[page].left.includes(panel) || PAGES[page].right.includes(panel) ? page : PAGE_ORDER.find((p) => PAGES[p].left.includes(panel) || PAGES[p].right.includes(panel));
    if (!target) return;
    if (target !== page) choose(target);
    activate(`${target}.${PAGES[target].left.includes(panel) ? 'left' : 'right'}`, panel);
    setRequest(panel);
  };
  useEffect(() => {
    parts.onPage(page);
    window.dispatchEvent(new Event('resize'));
  }, [page, phone, parts]);
  const all = [parts.viewer, parts.timeline, ...Object.values(parts.panels)];
  return (
    <div className={`workspace ${phone ? 'phone' : 'desktop'}`} data-page={page}>
      <header className="topbar">
        <Slot element={parts.bar} className="bar-slot" />
        {!phone && <PageBar page={page} onPage={choose} />}
      </header>
      <main className="workspace-body">{phone ? <Phone parts={parts} page={page} request={request} /> : <Desktop key={page} parts={parts} page={page} active={active} onActive={activate} />}</main>
      {phone && <PageBar page={page} onPage={choose} />}
      <Parking elements={all} />
    </div>
  );
}

export function mountWorkspace(root: HTMLElement, parts: WorkspaceParts): WorkspaceHandle {
  root.classList.add('react-root');
  const handle: { reveal?: (panel: string) => void } = {};
  createRoot(root).render(<Workspace parts={parts} handle={handle} />);
  return { reveal: (panel) => handle.reveal?.(panel) };
}
