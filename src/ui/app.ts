import { createMontageApi } from '../api/montage';
import { removeItem, splitAt } from '../core/operations';
import { projectDuration } from '../core/timeline';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { toast } from './components/toast';
import { formatTimecode, h } from './dom';
import { openExportDialog } from './export-dialog';
import { ColorPanel } from './panels/color-panel';
import { MediaPanel } from './panels/media-panel';
import { ScriptPanel } from './panels/script-panel';
import { TransitionPanel } from './panels/transition-panel';
import { Selection } from './selection';
import { TimelineView } from './timeline-view';

export function mountApp(root: HTMLElement, preview: HTMLCanvasElement, session: EditorSession): void {
  const { store, transport } = session;
  const selection = new Selection(store);
  const api = createMontageApi(session);
  Object.assign(globalThis, { montage: api });

  const fileInput = h('input', { type: 'file', accept: 'video/*,.mov,.mp4,.mkv,.webm,.mxf', multiple: true, hidden: true });
  const importFiles = async (files: Iterable<File>) => {
    const added = await session.importAndPlace(files, (file, error) => toast(`${file.name}: ${error.message}`, 'error'));
    if (added.length) {
      if (!selection.id) selection.set(store.project.tracks[0].items[0]?.id ?? null);
      timeline.fit();
      transport.seek(transport.time);
      toast(t('added', { name: added.map((a) => a.name).join(', ') }));
    }
  };
  fileInput.addEventListener('change', () => {
    if (fileInput.files) void importFiles([...fileInput.files]);
    fileInput.value = '';
  });

  const exportButton = h('button', { class: 'btn primary', id: 'export', onClick: () => openExportDialog(session) }, t('export'));
  const bar = h('header', { class: 'bar' },
    h('div', { class: 'brand' }, t('appName'), h('small', {}, t('tagline'))),
    h('button', { class: 'btn', id: 'import', onClick: () => fileInput.click() }, t('import')),
    exportButton,
    fileInput,
  );

  const info = h('div', { class: 'info' });
  const before = h('div', { class: 'badge', hidden: true }, t('before'));
  const empty = h('div', { class: 'empty' }, h('strong', {}, t('emptyTitle')), h('span', {}, t('emptyHint')));
  const screen = h('div', { class: 'screen' }, preview, info, before, empty);

  const play = h('button', { class: 'btn icon', id: 'play', 'aria-label': t('play'), onClick: () => transport.toggle() }, '▶');
  const timecode = h('div', { class: 'tc', id: 'tc' });
  const split = () => store.dispatch(splitAt(transport.time, session.videoTrackId));
  const remove = () => selection.id && store.dispatch(removeItem(selection.id));
  const compare = h('button', { class: 'btn', id: 'bypass', 'aria-pressed': 'false', onClick: () => toggleBypass() }, t('compare'));
  const editButtons = [
    h('button', { class: 'btn', id: 'split', title: 'S', onClick: split }, t('split')),
    h('button', { class: 'btn', id: 'delete', title: 'Delete', onClick: remove }, t('delete')),
    compare,
  ];
  const transportBar = h('div', { class: 'transport' },
    play,
    timecode,
    h('div', { class: 'spacer' }),
    ...editButtons,
    h('button', { class: 'btn icon', 'aria-label': t('zoomOut'), onClick: () => timeline.zoom(1 / 1.5) }, '−'),
    h('button', { class: 'btn icon', 'aria-label': t('zoomFit'), onClick: () => timeline.fit() }, '⤢'),
    h('button', { class: 'btn icon', 'aria-label': t('zoomIn'), onClick: () => timeline.zoom(1.5) }, '+'),
  );

  const timelineCanvas = h('canvas', { id: 'timeline' });
  const timeline = new TimelineView(timelineCanvas, store, transport, selection);

  const inspector = h('aside', { class: 'inspector' },
    new TransitionPanel(session, selection).element,
    new ColorPanel(session, selection).element,
    new MediaPanel(session).element,
    new ScriptPanel(api).element,
  );

  root.replaceChildren(bar, h('section', { class: 'viewer' }, screen, transportBar), h('section', { class: 'timeline' }, timelineCanvas), inspector);

  function toggleBypass() {
    transport.bypass = !transport.bypass;
    compare.setAttribute('aria-pressed', String(transport.bypass));
    before.hidden = !transport.bypass;
  }

  const renderTime = () => {
    const fps = store.project.settings?.fps ?? 25;
    timecode.replaceChildren(formatTimecode(transport.time, fps), h('span', {}, ` / ${formatTimecode(projectDuration(store.project), fps)}`));
  };
  transport.on('time', renderTime);
  transport.on('state', ({ playing }) => {
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? t('pause') : t('play'));
  });

  const syncChrome = () => {
    const hasItems = store.project.tracks.some((tr) => tr.items.length);
    empty.hidden = hasItems;
    exportButton.disabled = !hasItems;
    for (const b of editButtons) b.disabled = !hasItems;
    const settings = store.project.settings;
    info.textContent = settings ? `${settings.width}×${settings.height} · ${+settings.fps.toFixed(3)} ${t('fps')} · ${session.engine.mode}` : '';
    renderTime();
  };
  store.on('change', syncChrome);
  syncChrome();

  new ResizeObserver(() => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const height = Math.min(Math.round(screen.clientHeight * dpr), session.engine.budget.previewMaxHeight);
    const width = Math.round((height * screen.clientWidth) / Math.max(1, screen.clientHeight));
    void session.engine.remote.resize(Math.max(2, width), Math.max(2, height));
  }).observe(screen);

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) void importFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const fps = store.project.settings?.fps ?? 25;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') e.shiftKey ? store.redo() : store.undo();
    else if (mod && e.code === 'KeyY') store.redo();
    else if (mod) return;
    else if (e.code === 'Space') transport.toggle();
    else if (e.code === 'KeyS') split();
    else if (e.key === 'Delete' || e.key === 'Backspace') remove();
    else if (e.code === 'ArrowLeft') transport.seek(transport.time - 1 / fps);
    else if (e.code === 'ArrowRight') transport.seek(transport.time + 1 / fps);
    else if (e.code === 'KeyB') toggleBypass();
    else return;
    e.preventDefault();
  });

  session.on('error', (message) => toast(message, 'error'));
  session.engine.events.on('context', ({ state }) => toast(t(state === 'lost' ? 'gpuLost' : 'gpuRestored'), state === 'lost' ? 'error' : 'info'));
}
