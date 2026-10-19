import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../i18n';
import type { Strings } from '../../i18n/en';

export type PageId = 'edit' | 'fusion' | 'color' | 'fairlight' | 'deliver';

export interface WorkspaceParts {
  readonly bar: HTMLElement;
  readonly viewer: HTMLElement;
  readonly timeline: HTMLElement;
  readonly panels: Readonly<Record<string, HTMLElement>>;
  readonly onPage: (page: PageId) => void;
}

interface PageLayout {
  readonly label: keyof Strings;
  readonly left: readonly string[];
  readonly right: readonly string[];
}

export const PAGES: Readonly<Record<PageId, PageLayout>> = {
  edit: { label: 'pageEdit', left: ['media', 'markers', 'subtitles'], right: ['item', 'transition', 'scopes', 'color', 'stills', 'mixer', 'script'] },
  fusion: { label: 'pageFusion', left: ['media'], right: ['item', 'scopes'] },
  color: { label: 'pageColor', left: ['stills'], right: ['color', 'scopes', 'item'] },
  fairlight: { label: 'pageFairlight', left: ['media'], right: ['mixer', 'item'] },
  deliver: { label: 'pageDeliver', left: ['deliver'], right: ['subtitles'] },
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

function Column({ keys, panels }: { keys: readonly string[]; panels: WorkspaceParts['panels'] }) {
  return (
    <aside className="inspector">
      {keys.filter((k) => panels[k]).map((k) => (
        <Slot key={k} element={panels[k]} className="panel-slot" />
      ))}
    </aside>
  );
}

function PageBar({ page, onPage }: { page: PageId; onPage: (page: PageId) => void }) {
  return (
    <nav className="page-bar" role="tablist" aria-label={t('pages')}>
      {PAGE_ORDER.map((id) => (
        <button key={id} id={`page-${id}`} role="tab" aria-selected={id === page} className="page-tab" onClick={() => onPage(id)}>
          <span className={`page-icon page-icon-${id}`} aria-hidden="true" />
          <span>{t(PAGES[id].label)}</span>
        </button>
      ))}
    </nav>
  );
}

function Desktop({ parts, page }: { parts: WorkspaceParts; page: PageId }) {
  const layout = PAGES[page];
  const center = (
    <Split id={`${page}.rows`} direction="column" initial={Math.round(innerHeight * 0.36)} min={120} max={Math.round(innerHeight * 0.75)} side="end">
      <Slot element={parts.viewer} className="viewer-slot" />
      <Slot element={parts.timeline} className="timeline-slot" />
    </Split>
  );
  const withRight = layout.right.length ? (
    <Split id={`${page}.right`} direction="row" initial={320} min={240} max={560} side="end">
      {center}
      <Column keys={layout.right} panels={parts.panels} />
    </Split>
  ) : center;
  return layout.left.length ? (
    <Split id={`${page}.left`} direction="row" initial={280} min={200} max={520} side="start">
      <Column keys={layout.left} panels={parts.panels} />
      {withRight}
    </Split>
  ) : withRight;
}

function Phone({ parts, page }: { parts: WorkspaceParts; page: PageId }) {
  const [sheet, setSheet] = useState<string | null>(null);
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
            {parts.panels[k].querySelector('h2')?.textContent ?? k}
          </button>
        ))}
      </div>
      {sheet && (
        <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-label={parts.panels[sheet].querySelector('h2')?.textContent ?? sheet}>
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

function Workspace({ parts }: { parts: WorkspaceParts }) {
  const phone = useMedia(PHONE_QUERY);
  const [page, setPage] = useState<PageId>(() => stored('montage.page', 'edit'));
  const choose = (next: PageId) => {
    setPage(next);
    remember('montage.page', next);
  };
  useEffect(() => {
    parts.onPage(page);
    window.dispatchEvent(new Event('resize'));
  }, [page, phone, parts]);
  const all = [parts.viewer, parts.timeline, ...Object.values(parts.panels)];
  return (
    <div className={`workspace ${phone ? 'phone' : 'desktop'}`} data-page={page}>
      <Slot element={parts.bar} className="bar-slot" />
      <main className="workspace-body">{phone ? <Phone parts={parts} page={page} /> : <Desktop key={page} parts={parts} page={page} />}</main>
      <PageBar page={page} onPage={choose} />
      <Parking elements={all} />
    </div>
  );
}

export function mountWorkspace(root: HTMLElement, parts: WorkspaceParts): void {
  root.classList.add('react-root');
  createRoot(root).render(<Workspace parts={parts} />);
}
