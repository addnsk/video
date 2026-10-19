import { createMontageApi } from '../api/montage';
import { splitAt } from '../core/operations';
import { findPlacement, projectDuration } from '../core/timeline';
import type { TrackApply } from '../core/tracking';
import { MEDIA_TYPES, pickFiles, type PickedFile } from '../host/file-picker';
import type { ProjectPersistence } from '../host/persistence/project-persistence';
import type { RemoteStorage } from '../host/remote/remote-storage';
import type { EditorSession } from '../host/session';
import { LevelMeter } from './components/level-meter';
import { MaskOverlay } from './mask-overlay';
import { NodeEditor } from './node-editor';
import { PointPicker } from './point-picker';
import { trackFromViewer } from './track-action';
import { pickQualifier } from '../host/qualifier-pick';
import { languageSelect } from './components/language-select';
import { offlineBanner } from './components/offline-banner';
import { projectMenu } from './project-menu';
import { t } from '../i18n';
import { toast } from './components/toast';
import { formatTimecode, h } from './dom';
import { openExportDialog } from './export-dialog';
import { openRenderQueue } from './render-queue-dialog';
import { deliverPanel } from './deliver-panel';
import { mountWorkspace } from './react/workspace';
import { openCloudDialog } from './cloud-dialog';
import { ColorPanel } from './panels/color-panel';
import { MediaPanel } from './panels/media-panel';
import { MixerPanel } from './panels/mixer-panel';
import { MarkersPanel } from './panels/markers-panel';
import { SubtitlesPanel, subtitleOverlay } from './panels/subtitles-panel';
import { ScopesPanel } from './panels/scopes-panel';
import { StillsPanel } from './panels/stills-panel';
import { ItemPanel } from './panels/item-panel';
import { addTrack, insertText } from '../core/operations';
import { ScriptPanel } from './panels/script-panel';
import { TransitionPanel } from './panels/transition-panel';
import { Selection } from './selection';
import { TimelineView } from './timeline-view';
import { EditControls } from './edit-controls';
import { TimelineSwitcher } from './timeline-switcher';

export interface AppHandle {
  readonly fit: () => void;
}

export function mountApp(root: HTMLElement, preview: HTMLCanvasElement, session: EditorSession, persistence: ProjectPersistence, sourcePreview: HTMLCanvasElement | null = null, remote: RemoteStorage | null = null): AppHandle {
  const { store, transport } = session;
  const selection = new Selection(store);
  const api = createMontageApi(session, (id) => selection.set(id), remote ? { remote } : {});
  Object.assign(globalThis, { montage: api });
  const controls = new EditControls(session, selection, api);
  const active = () => controls.active;

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
    h('button', { class: 'btn', id: 'queue-open', onClick: () => openRenderQueue(session) }, t('queue')),
    ...(remote ? [h('button', { class: 'btn', id: 'cloud-open', onClick: () => openCloudDialog(session, remote) }, t('cloud'))] : []),
    exportButton,
    languageSelect(),
  );

  const info = h('div', { class: 'info' });
  const before = h('div', { class: 'badge', hidden: true }, t('before'));
  const empty = h('div', { class: 'empty' }, h('strong', {}, t('emptyTitle')), h('span', {}, t('emptyHint')));
  const screen = h('div', { class: 'screen', id: 'timeline-screen' }, preview, subtitleOverlay(session, preview), info, before, empty, offlineBanner(session, persistence));
  const sourceLabel = h('div', { class: 'info' });
  const sourceScreen = sourcePreview && h('div', { class: 'screen', id: 'source-screen', hidden: true }, sourcePreview, sourceLabel);
  const screens = h('div', { class: 'screens' }, sourceScreen, screen);
  if (sourceScreen) {
    sourceScreen.addEventListener('pointerdown', () => session.source.show('source'));
    screen.addEventListener('pointerdown', () => session.source.show('timeline'));
    const syncScreens = () => {
      sourceScreen.hidden = !session.source.assetId;
      screens.classList.toggle('dual', !!session.source.assetId);
      sourceScreen.classList.toggle('active', session.source.viewer === 'source');
      screen.classList.toggle('active', !!session.source.assetId && session.source.viewer === 'timeline');
      sourceLabel.textContent = session.source.assetId ? (store.project.assets[session.source.assetId]?.name ?? '') : '';
    };
    session.source.on('change', syncScreens);
    syncScreens();
    new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const height = Math.min(Math.round(sourceScreen.clientHeight * dpr), session.engine.budget.previewMaxHeight);
      const width = Math.round((height * sourceScreen.clientWidth) / Math.max(1, sourceScreen.clientHeight));
      session.source.resize(Math.max(2, width), Math.max(2, height));
    }).observe(sourceScreen);
  }

  const play = h('button', { class: 'btn icon', id: 'play', 'aria-label': t('play'), onClick: () => active().toggle() }, '▶');
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
  const remove = () => controls.deleteSelection(false);
  const compare = h('button', { class: 'btn', id: 'bypass', 'aria-pressed': 'false', onClick: () => toggleBypass() }, t('compare'));
  const editButtons = [
    h('button', { class: 'btn', id: 'split', title: 'S', onClick: split }, t('split')),
    h('button', { class: 'btn', id: 'delete', title: 'Delete', onClick: remove }, t('delete')),
    compare,
  ];
  const transportBar = h('div', { class: 'transport' },
    controls.viewerTabs,
    play,
    timecode,
    rate,
    meter.element,
    liveLoudness,
    h('div', { class: 'spacer' }),
    ...editButtons,
  );

  const timelineCanvas = h('canvas', { id: 'timeline' });
  const timeline = new TimelineView(timelineCanvas, session, selection, () => controls.tool);
  const addTitle = () => {
    const overlay = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.magnetic);
    if (!overlay) store.dispatch(addTrack('video'));
    const trackId = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.magnetic)!.id;
    const before = new Set(store.project.tracks.flatMap((tr) => tr.items.map((i) => i.id)));
    store.dispatch(insertText(trackId, transport.time, 3, { content: t('newTitle') }));
    const created = store.project.tracks.flatMap((tr) => tr.items).find((i) => !before.has(i.id));
    if (created) selection.set(created.id);
  };
  const switcher = new TimelineSwitcher(session, selection, api);
  const timelineActions = h('div', { class: 'tab-actions' },
    switcher.element,
    h('button', { class: 'btn small', id: 'add-title', onClick: addTitle }, t('addTitle')),
    h('button', { class: 'btn small', id: 'add-video-track', onClick: () => store.dispatch(addTrack('video')) }, t('addVideoTrack')),
    h('button', { class: 'btn small', id: 'add-audio-track', onClick: () => store.dispatch(addTrack('audio')) }, t('addAudioTrack')),
  );
  const timelineTools = h('div', { class: 'timeline-tools' },
    controls.editBar,
    controls.toolBar,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn small icon', 'aria-label': t('zoomOut'), onClick: () => timeline.zoom(1 / 1.5) }, '−'),
    h('button', { class: 'btn small icon', 'aria-label': t('zoomFit'), onClick: () => timeline.fit() }, '⤢'),
    h('button', { class: 'btn small icon', 'aria-label': t('zoomIn'), onClick: () => timeline.zoom(1.5) }, '+'),
  );

  const picker = new PointPicker(screen, () => {
    const settings = store.project.settings;
    return settings ? settings.width / settings.height : 16 / 9;
  });
  const track = (itemId: string, apply: TrackApply) => void trackFromViewer(session, picker, itemId, apply);
  const panels: Record<string, HTMLElement> = {
    scopes: new ScopesPanel(session).element,
    item: new ItemPanel(session, selection, (itemId) => track(itemId, 'stabilize')).element,
    transition: new TransitionPanel(session, selection).element,
    color: new ColorPanel(session, selection).element,
    stills: new StillsPanel(session, selection).element,
    mixer: new MixerPanel(session).element,
    markers: new MarkersPanel(session).element,
    subtitles: new SubtitlesPanel(session, api).element,
    media: new MediaPanel(session, timeline, (assetId) => session.source.open(assetId), (timelineId) => {
      try {
        const result = api.edit.insert({ asset: api.timelines.asset(timelineId), in: 0, at: transport.time });
        selection.set(result.video);
      } catch (error) {
        toast((error as Error).message, 'error');
      }
    }, api).element,
    script: new ScriptPanel(api).element,
    deliver: deliverPanel(session),
  };

  const pickColor = async (itemId: string, nodeId: string, add: boolean) => {
    const point = await picker.pick(t('qualifierPickHint'));
    if (!point) return;
    try {
      await pickQualifier(session, itemId, nodeId, point, { add });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };
  const nodeEditor = new NodeEditor(session, selection, track, (itemId, nodeId, add) => void pickColor(itemId, nodeId, add));
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
    timelineActions.hidden = view !== 'timeline';
    for (const tab of viewTabs.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String((tab as HTMLElement).dataset.view === view));
    if (view === 'timeline') timeline.draw();
  };
  viewTabs.append(
    h('button', { class: 'tab', role: 'tab', id: 'view-timeline', dataset: { view: 'timeline' }, onClick: () => showView('timeline') }, t('viewTimeline')),
    h('button', { class: 'tab', role: 'tab', id: 'view-nodes', dataset: { view: 'nodes' }, onClick: () => showView('nodes') }, t('viewNodes')),
    timelineActions,
  );
  showView('timeline');

  mountWorkspace(root, {
    bar,
    viewer: h('section', { class: 'viewer' }, screens, transportBar),
    timeline: h('section', { class: 'timeline' }, viewTabs, timelinePane, nodeEditor.element),
    panels,
    onPage: (page) => showView(page === 'fusion' || page === 'color' ? 'nodes' : 'timeline'),
  });

  function toggleBypass() {
    transport.bypass = !transport.bypass;
    compare.setAttribute('aria-pressed', String(transport.bypass));
    before.hidden = !transport.bypass;
  }

  const renderTime = () => {
    const fps = store.project.settings?.fps ?? 25;
    const viewed = session.source.viewer === 'source' ? session.source.store.project : store.project;
    timecode.replaceChildren(formatTimecode(active().time, fps), h('span', {}, ` / ${formatTimecode(projectDuration(viewed), fps)}`));
  };
  transport.on('time', renderTime);
  session.source.transport.on('time', renderTime);
  session.source.on('change', renderTime);
  const onState = ({ playing, rate: speed }: { playing: boolean; rate: number }) => {
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
  };
  transport.on('state', onState);
  session.source.transport.on('state', onState);

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
    else if (controls.handleKey(e)) void 0;
    else if (mod) return;
    else if (e.code === 'Space') active().toggle();
    else if (e.code === 'KeyJ') void active().shuttle(-1);
    else if (e.code === 'KeyK') active().pause();
    else if (e.code === 'KeyL') void active().shuttle(1);
    else if (e.code === 'KeyS') split();
    else if (e.code === 'ArrowLeft') active().seek(active().time - 1 / fps);
    else if (e.code === 'ArrowRight') active().seek(active().time + 1 / fps);
    else if (e.code === 'KeyB') toggleBypass();
    else return;
    e.preventDefault();
  });

  session.on('error', (message) => toast(message, 'error'));
  session.engine.events.on('context', ({ state }) => toast(t(state === 'lost' ? 'gpuLost' : 'gpuRestored'), state === 'lost' ? 'error' : 'info'));
  return { fit: () => timeline.fit() };
}
