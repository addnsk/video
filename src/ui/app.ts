import { createMontageApi } from '../api/montage';
import { removeItem, splitAt } from '../core/operations';
import { findPlacement, projectDuration } from '../core/timeline';
import type { TrackApply } from '../core/tracking';
import { MEDIA_TYPES, pickFiles, type PickedFile } from '../host/file-picker';
import type { ProjectPersistence } from '../host/persistence/project-persistence';
import type { EditorSession } from '../host/session';
import { LevelMeter } from './components/level-meter';
import { MaskOverlay } from './mask-overlay';
import { NodeEditor } from './node-editor';
import { PointPicker } from './point-picker';
import { trackFromViewer } from './track-action';
import { languageSelect } from './components/language-select';
import { offlineBanner } from './components/offline-banner';
import { projectMenu } from './project-menu';
import { t } from '../i18n';
import { toast } from './components/toast';
import { formatTimecode, h } from './dom';
import { openExportDialog } from './export-dialog';
import { ColorPanel } from './panels/color-panel';
import { MediaPanel } from './panels/media-panel';
import { MixerPanel } from './panels/mixer-panel';
import { ScopesPanel } from './panels/scopes-panel';
import { StillsPanel } from './panels/stills-panel';
import { ItemPanel } from './panels/item-panel';
import { addTrack, insertText } from '../core/operations';
import { ScriptPanel } from './panels/script-panel';
import { TransitionPanel } from './panels/transition-panel';
import { Selection } from './selection';
import { TimelineView } from './timeline-view';

export interface AppHandle {
  readonly fit: () => void;
}

export function mountApp(root: HTMLElement, preview: HTMLCanvasElement, session: EditorSession, persistence: ProjectPersistence): AppHandle {
  const { store, transport } = session;
  const selection = new Selection(store);
  const api = createMontageApi(session, (id) => selection.set(id));
  Object.assign(globalThis, { montage: api });

  const importFiles = async (picked: Iterable<PickedFile>) => {
    const added = await session.importAndPlace(picked, (file, error) => toast(`${file.name}: ${error.message}`, 'error'));
    if (added.length) {
      if (!selection.id) selection.set(store.project.tracks[0].items[0]?.id ?? null);
      timeline.fit();
      transport.seek(transport.time);
      toast(t('added', { name: added.map((a) => a.name).join(', ') }));
    }
  };

  const exportButton = h('button', { class: 'btn primary', id: 'export', onClick: () => openExportDialog(session) }, t('export'));
  const bar = h('header', { class: 'bar' },
    h('div', { class: 'brand' }, t('appName'), h('small', {}, t('tagline'))),
    projectMenu(session, persistence),
    h('button', { class: 'btn', id: 'import', onClick: async () => importFiles(await pickFiles({ ...MEDIA_TYPES, multiple: true })) }, t('import')),
    exportButton,
    languageSelect(),
  );

  const info = h('div', { class: 'info' });
  const before = h('div', { class: 'badge', hidden: true }, t('before'));
  const empty = h('div', { class: 'empty' }, h('strong', {}, t('emptyTitle')), h('span', {}, t('emptyHint')));
  const screen = h('div', { class: 'screen' }, preview, info, before, empty, offlineBanner(session, persistence));

  const play = h('button', { class: 'btn icon', id: 'play', 'aria-label': t('play'), onClick: () => transport.toggle() }, '▶');
  const timecode = h('div', { class: 'tc', id: 'tc' });
  const rate = h('span', { class: 'rate', id: 'rate', hidden: true });
  const meter = new LevelMeter(transport, t('audioLevels'));
  const liveLoudness = h('span', { class: 'loudness-live', id: 'loudness-live', title: t('loudnessLiveHint') });
  let loudnessTimer = 0;
  const showLoudness = () => {
    const reading = transport.loudness();
    liveLoudness.textContent = reading && Number.isFinite(reading.shortTerm) ? `${reading.momentary.toFixed(1)} / ${reading.shortTerm.toFixed(1)} LUFS` : '';
  };
  const split = () => {
    const placement = selection.id ? findPlacement(store.project, selection.id) : null;
    const covers = placement && transport.time > placement.start && transport.time < placement.end;
    store.dispatch(splitAt(transport.time, covers ? placement.track.id : session.videoTrackId));
  };
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
    rate,
    meter.element,
    liveLoudness,
    h('div', { class: 'spacer' }),
    ...editButtons,
    h('button', { class: 'btn icon', 'aria-label': t('zoomOut'), onClick: () => timeline.zoom(1 / 1.5) }, '−'),
    h('button', { class: 'btn icon', 'aria-label': t('zoomFit'), onClick: () => timeline.fit() }, '⤢'),
    h('button', { class: 'btn icon', 'aria-label': t('zoomIn'), onClick: () => timeline.zoom(1.5) }, '+'),
  );

  const timelineCanvas = h('canvas', { id: 'timeline' });
  const timeline = new TimelineView(timelineCanvas, session, selection);
  const addTitle = () => {
    const overlay = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.magnetic);
    if (!overlay) store.dispatch(addTrack('video'));
    const trackId = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.magnetic)!.id;
    const before = new Set(store.project.tracks.flatMap((tr) => tr.items.map((i) => i.id)));
    store.dispatch(insertText(trackId, transport.time, 3, { content: t('newTitle') }));
    const created = store.project.tracks.flatMap((tr) => tr.items).find((i) => !before.has(i.id));
    if (created) selection.set(created.id);
  };
  const timelineTools = h('div', { class: 'timeline-tools' },
    h('button', { class: 'btn small', id: 'add-title', onClick: addTitle }, t('addTitle')),
    h('button', { class: 'btn small', id: 'add-video-track', onClick: () => store.dispatch(addTrack('video')) }, t('addVideoTrack')),
    h('button', { class: 'btn small', id: 'add-audio-track', onClick: () => store.dispatch(addTrack('audio')) }, t('addAudioTrack')),
  );

  const picker = new PointPicker(screen, () => {
    const settings = store.project.settings;
    return settings ? settings.width / settings.height : 16 / 9;
  });
  const track = (itemId: string, apply: TrackApply) => void trackFromViewer(session, picker, itemId, apply);
  const inspector = h('aside', { class: 'inspector' },
    new ScopesPanel(session).element,
    new ItemPanel(session, selection, (itemId) => track(itemId, 'stabilize')).element,
    new TransitionPanel(session, selection).element,
    new ColorPanel(session, selection).element,
    new StillsPanel(session, selection).element,
    new MixerPanel(session).element,
    new MediaPanel(session, timeline).element,
    new ScriptPanel(api).element,
  );

  const nodeEditor = new NodeEditor(session, selection, track);
  const maskOverlay = new MaskOverlay(session, screen);
  nodeEditor.on('select', (target) => maskOverlay.show(target));
  const viewing = h('button', { class: 'viewing', id: 'viewing-node', hidden: true, onClick: () => session.viewNode(null) });
  screen.append(viewing);
  session.on('view', (target) => {
    viewing.hidden = !target;
    if (!target) return;
    const effect = findPlacement(store.project, target.itemId)?.item.effects.find((e) => e.id === target.nodeId);
    viewing.textContent = t('viewingNode', { name: effect ? (session.registry.get(effect.type)?.name ?? effect.type) : t('nodesSource') });
  });
  const timelinePane = h('div', { class: 'timeline-pane' }, timelineTools, timelineCanvas);
  const viewTabs = h('div', { class: 'view-tabs', role: 'tablist' });
  const showView = (view: 'timeline' | 'nodes') => {
    timelinePane.hidden = view !== 'timeline';
    nodeEditor.show(view === 'nodes');
    maskOverlay.show(nodeEditor.selected);
    for (const tab of viewTabs.children) tab.setAttribute('aria-selected', String((tab as HTMLElement).dataset.view === view));
    if (view === 'timeline') timeline.draw();
  };
  viewTabs.append(
    h('button', { class: 'tab', role: 'tab', id: 'view-timeline', dataset: { view: 'timeline' }, onClick: () => showView('timeline') }, t('viewTimeline')),
    h('button', { class: 'tab', role: 'tab', id: 'view-nodes', dataset: { view: 'nodes' }, onClick: () => showView('nodes') }, t('viewNodes')),
  );
  showView('timeline');

  root.replaceChildren(bar, h('section', { class: 'viewer' }, screen, transportBar), h('section', { class: 'timeline' }, viewTabs, timelinePane, nodeEditor.element), inspector);

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
  transport.on('state', ({ playing, rate: speed }) => {
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? t('pause') : t('play'));
    rate.hidden = !playing || speed === 1;
    clearInterval(loudnessTimer);
    if (playing) {
      meter.start();
      loudnessTimer = window.setInterval(showLoudness, 250);
    } else meter.stop();
    showLoudness();
    rate.textContent = `${speed < 0 ? '−' : ''}${Math.abs(speed)}×`;
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
    if (e.dataTransfer?.files.length) void importFiles([...e.dataTransfer.files].map((file) => ({ file })));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const fps = store.project.settings?.fps ?? 25;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') e.shiftKey ? store.redo() : store.undo();
    else if (mod && e.code === 'KeyY') store.redo();
    else if (mod) return;
    else if (e.code === 'Space') transport.toggle();
    else if (e.code === 'KeyJ') void transport.shuttle(-1);
    else if (e.code === 'KeyK') transport.pause();
    else if (e.code === 'KeyL') void transport.shuttle(1);
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
  return { fit: () => timeline.fit() };
}
