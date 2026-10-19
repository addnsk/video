import type { MontageApi } from '../../api/montage';
import { METADATA_FIELDS, binContents, binsOf, entryOf, searchMedia } from '../../core/bins';
import type { AssetMeta, Bin } from '../../core/model';
import { insertItem } from '../../core/operations';
import { canNest, timelineData, timelineList } from '../../core/timelines';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { dragSource } from '../components/drag-source';
import { toast } from '../components/toast';
import { formatDuration, h } from '../dom';
import { iconButton } from '../icons';
import { icon } from '../icons';
import type { DropTarget } from '../drop-target';
import { Panel } from './panel';

const ALL = '';
const TEXT_FIELDS = METADATA_FIELDS.filter((f) => f !== 'keywords' && f !== 'rating' && f !== 'flagged');

export class MediaPanel extends Panel {
  private bin = ALL;
  private query = '';
  private open = new Set<string>();
  private thumbs = new Map<string, () => void>();
  private controls: HTMLElement;
  private list = h('div', { class: 'media-list' });
  private binSelect: HTMLSelectElement;
  private search: HTMLInputElement;

  constructor(
    private session: EditorSession,
    private dropTarget: DropTarget,
    private openSource: (assetId: string) => void,
    private insertTimeline: (timelineId: string) => void,
    private api: MontageApi,
    private onImport: () => void,
  ) {
    super('media', t('mediaTitle'));
    this.binSelect = h('select', { id: 'media-bin', 'aria-label': t('mediaBin'), onChange: () => {
      this.bin = this.binSelect.value;
      this.renderList();
    } });
    this.search = h('input', { type: 'search', id: 'media-search', placeholder: t('mediaSearch'), 'aria-label': t('mediaSearch'), onInput: () => {
      this.query = this.search.value;
      this.renderList();
    } });
    this.controls = h('div', { class: 'media-controls' },
      h('div', { class: 'row' },
        iconButton('import', t('import'), { id: 'import', class: 'accent', onClick: () => this.onImport() }),
        this.binSelect,
        iconButton('folderPlus', t('binNew'), { id: 'bin-new', onClick: () => this.attempt(() => this.newBin(false)) }),
        iconButton('filter', t('binSmart'), { id: 'bin-smart', onClick: () => this.attempt(() => this.newBin(true)) }),
        iconButton('folderMinus', t('binRemove'), { id: 'bin-remove', onClick: () => this.attempt(() => this.removeBin()) }),
        iconButton('multicam', t('multicamNew'), { id: 'multicam-new', onClick: () => void this.newMulticam() }),
      ),
      this.search,
    );
    this.body.replaceChildren(this.controls, this.list);
    session.store.on('change', ({ project, previous }) => {
      if (project.assets !== previous.assets || project.timeline !== previous.timeline || project.timelines !== previous.timelines || project.bins !== previous.bins || project.media !== previous.media) this.schedule();
    });
    session.on('proxy', () => this.renderList());
    session.on('thumbnails', (assetId) => this.thumbs.get(assetId)?.());
    this.render();
  }

  private thumbnail(asset: { id: string; hasVideo: boolean }, duration: string): HTMLElement {
    const canvas = h('canvas', { width: 256, height: 144 });
    const frame = h('div', { class: `media-thumb${asset.hasVideo ? '' : ' audio'}` }, asset.hasVideo ? canvas : icon('audio', 28), h('span', { class: 'media-duration' }, duration));
    if (!asset.hasVideo) return frame;
    const paint = () => {
      const strip = this.session.thumbnails(asset.id);
      const image = strip?.frames[Math.floor(strip.frames.length / 2)] ?? strip?.frames.find((f) => f);
      if (!image) return;
      const g = canvas.getContext('2d')!;
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      g.drawImage(image, (canvas.width - image.width * scale) / 2, (canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale);
      frame.classList.add('ready');
    };
    this.thumbs.set(asset.id, paint);
    paint();
    return frame;
  }

  private attempt(run: () => void) {
    try {
      run();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  private newBin(smart: boolean) {
    const name = prompt(t(smart ? 'binSmartName' : 'binName'));
    if (!name) return;
    const query = smart ? prompt(t('binSmartQuery'), this.query) : undefined;
    if (smart && !query) return;
    const parent = this.bin && !binsOf(this.session.store.project).find((b) => b.id === this.bin)?.query ? this.bin : null;
    this.bin = this.api.media.addBin(name, { parent: smart ? null : parent, ...(query ? { query } : {}) });
    this.render();
  }

  private async newMulticam() {
    const angles = this.visible().filter((a) => a.hasVideo).map((a) => a.id);
    if (angles.length < 2) {
      toast(t('multicamNeedsAngles'), 'error');
      return;
    }
    const name = prompt(t('multicamName'), t('multicamDefault'));
    if (!name) return;
    try {
      const withSound = angles.filter((id) => this.session.store.project.assets[id].hasAudio).length;
      const result = await this.api.multicam.create(name, angles, { sync: withSound ? 'audio' : 'none' });
      toast(t(withSound ? 'multicamCreated' : 'multicamCreatedPlain', { count: angles.length }));
      this.openSource(result.asset);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  private removeBin() {
    if (!this.bin) return;
    this.api.media.removeBin(this.bin);
    this.bin = ALL;
    this.render();
  }

  private proxyLabel(asset: AssetMeta): string {
    const state = this.session.proxies.get(asset.id);
    if (!state) return '';
    if (state.state === 'building') return t('proxyBuilding', { percent: Math.round(state.fraction * 100) });
    return t(({ queued: 'proxyQueued', ready: 'proxyReady', failed: 'proxyFailed', building: 'proxyBuilding' } as const)[state.state]);
  }

  private binOptions(): HTMLOptionElement[] {
    const bins = binsOf(this.session.store.project);
    const out: HTMLOptionElement[] = [h('option', { value: ALL, selected: this.bin === ALL }, t('mediaAll'))];
    const walk = (parent: string | null, depth: number) => {
      for (const bin of bins.filter((b) => b.parent === parent && !b.query)) {
        out.push(h('option', { value: bin.id, selected: this.bin === bin.id }, `${'  '.repeat(depth)}${bin.name}`));
        walk(bin.id, depth + 1);
      }
    };
    walk(null, 0);
    for (const bin of bins.filter((b) => b.query)) out.push(h('option', { value: bin.id, selected: this.bin === bin.id }, `⌕ ${bin.name}`));
    return out;
  }

  protected render() {
    const bins = binsOf(this.session.store.project);
    if (this.bin && !bins.some((b) => b.id === this.bin)) this.bin = ALL;
    this.binSelect.replaceChildren(...this.binOptions());
    this.renderList();
  }

  private visible(): AssetMeta[] {
    const project = this.session.store.project;
    let assets = this.bin ? binContents(project, this.bin) : Object.values(project.assets);
    if (this.query.trim()) {
      try {
        const hits = new Set(searchMedia(project, this.query).map((a) => a.id));
        assets = assets.filter((a) => hits.has(a.id));
        this.search.setCustomValidity('');
      } catch (error) {
        this.search.setCustomValidity((error as Error).message);
      }
    }
    return assets.filter((a) => !a.timeline);
  }

  private renderList() {
    const project = this.session.store.project;
    if (!Object.values(project.assets).some((a) => !a.timeline)) {
      this.list.replaceChildren(h('p', { class: 'hint' }, t('mediaEmpty')));
      return;
    }
    const timelines = timelineList(project).filter((x) => !x.active && canNest(project, x.id));
    const timelineRows = timelines.length && !this.bin && !this.query
      ? [
          h('h3', { class: 'sub' }, t('mediaTimelines')),
          ...timelines.map((x) =>
            h('div', { class: 'media-item', 'data-timeline': x.id },
              h('b', {}, x.name),
              h('div', { class: 'row' },
                iconButton('plus', t('timelineInsert'), { 'data-insert-timeline': x.id, onClick: () => this.insertTimeline(x.id) }),
                timelineData(project, x.id)?.multicam && iconButton('eye', t('multicamView'), { 'data-multiview': x.id, onClick: () => this.attempt(() => this.openSource(this.api.timelines.asset(x.id))) }),
              ),
            ),
          ),
        ]
      : [];
    const assets = this.visible();
    this.list.replaceChildren(...timelineRows, ...(assets.length ? assets.map((asset) => this.item(asset)) : [h('p', { class: 'hint' }, t('mediaNoMatch'))]));
  }

  private item(asset: AssetMeta): HTMLElement {
    const project = this.session.store.project;
    const meta = entryOf(project, asset.id).metadata ?? {};
    const proxy = this.proxyLabel(asset);
    const details = asset.hasVideo
      ? `${asset.codec} · ${asset.width}×${asset.height} · ${+asset.fps.toFixed(3)} ${t('fps')} · ${formatDuration(asset.end - asset.start)}`
      : `${asset.codec} · ${asset.sampleRate / 1000} kHz · ${formatDuration(asset.end - asset.start)}`;
    const audioTrack = project.tracks.find((tr) => tr.kind === 'audio');
    const expanded = this.open.has(asset.id);
    const actions = h('div', { class: 'row' },
      iconButton('eye', t('openInViewer'), { 'data-open-source': asset.id, onClick: () => this.openSource(asset.id) }),
      asset.hasVideo && iconButton('plus', t('addToTimeline'), { onClick: () => this.session.store.dispatch(insertItem(asset.id, { trackId: this.session.videoTrackId })) }),
      asset.hasAudio && audioTrack && iconButton('audio', t('addAudio'), {
        onClick: () => this.session.store.dispatch(insertItem(asset.id, { trackId: audioTrack.id, start: this.session.transport.time })),
      }),
      asset.hasVideo && !this.session.proxies.has(asset.id) && iconButton('bolt', t('makeProxy'), { onClick: () => this.session.requestProxy(asset.id) }),
      iconButton('info', t('mediaInfo'), { 'data-info': asset.id, 'aria-expanded': String(expanded), onClick: () => {
        if (expanded) this.open.delete(asset.id);
        else this.open.add(asset.id);
        this.renderList();
      } }),
    );
    const grip = h('span', { class: 'grip', role: 'button', 'aria-label': t('dragToTimeline'), title: t('dragToTimeline') }, icon('grip', 16));
    const badges = [meta.rating ? '★'.repeat(meta.rating) : '', meta.flagged ? '⚑' : '', meta.keywords?.join(', ') ?? ''].filter(Boolean).join('  ');
    const element = h('div', { class: 'media-item', 'data-asset': asset.id },
      this.thumbnail(asset, formatDuration(asset.end - asset.start)),
      h('b', { title: `${asset.name}\n${details}` }, asset.name),
      grip,
      badges && h('small', { class: 'badges' }, badges),
      proxy && h('small', { class: 'proxy' }, proxy),
      actions,
      expanded && this.editor(asset),
    );
    element.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('button, input, select, textarea')) this.openSource(asset.id);
    });
    dragSource(element, grip, {
      label: () => asset.name,
      move: (point) => this.dropTarget.hover(point, asset.id),
      drop: (point) => void this.dropTarget.drop(point, asset.id),
      cancel: () => this.dropTarget.leave(),
    });
    return element;
  }

  private editor(asset: AssetMeta): HTMLElement {
    const project = this.session.store.project;
    const entry = entryOf(project, asset.id);
    const meta = entry.metadata ?? {};
    const set = (patch: Record<string, unknown>) => this.attempt(() => this.api.media.metadata(asset.id, patch));
    const field = (name: (typeof METADATA_FIELDS)[number] | 'name' | 'bin', input: HTMLElement) => h('label', { class: 'meta-field' }, h('span', {}, t(`meta_${name}` as const)), input);
    const binChoices = binsOf(project).filter((b: Bin) => !b.query);
    return h('div', { class: 'meta-editor', 'data-meta': asset.id },
      field('name', h('input', { type: 'text', value: asset.name, 'data-field': 'name', onChange: (e: Event) => this.attempt(() => this.api.media.rename(asset.id, (e.target as HTMLInputElement).value)) })),
      field('bin', h('select', { 'data-field': 'bin', onChange: (e: Event) => this.attempt(() => this.api.media.move(asset.id, (e.target as HTMLSelectElement).value || null)) },
        h('option', { value: '', selected: !entry.bin }, t('mediaAll')),
        ...binChoices.map((b) => h('option', { value: b.id, selected: entry.bin === b.id }, b.name)),
      )),
      ...TEXT_FIELDS.map((name) =>
        field(name, h('input', { type: 'text', value: String(meta[name] ?? ''), 'data-field': name, onChange: (e: Event) => set({ [name]: (e.target as HTMLInputElement).value }) })),
      ),
      field('keywords', h('input', { type: 'text', value: (meta.keywords ?? []).join(', '), 'data-field': 'keywords', onChange: (e: Event) => set({ keywords: (e.target as HTMLInputElement).value.split(',') }) })),
      field('rating', h('select', { 'data-field': 'rating', onChange: (e: Event) => set({ rating: Number((e.target as HTMLSelectElement).value) }) },
        ...[0, 1, 2, 3, 4, 5].map((n) => h('option', { value: String(n), selected: (meta.rating ?? 0) === n }, n ? '★'.repeat(n) : '—')),
      )),
      field('flagged', h('input', { type: 'checkbox', checked: !!meta.flagged, 'data-field': 'flagged', onChange: (e: Event) => set({ flagged: (e.target as HTMLInputElement).checked }) })),
      iconButton('trash', t('mediaRemove'), { class: 'danger', 'data-remove-asset': asset.id, onClick: () => this.attempt(() => this.api.media.remove(asset.id)) }),
    );
  }
}
