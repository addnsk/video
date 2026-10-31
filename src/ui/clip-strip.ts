import { projectDuration, placeTrack, type Placement } from '../core/timeline';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { formatTimecode, h } from './dom';
import type { Selection } from './selection';

const THUMB_WIDTH = 112;
const THUMB_HEIGHT = 63;

export class ClipStrip {
  readonly element: HTMLElement;
  private row = h('div', { class: 'clip-strip-row', role: 'listbox', 'aria-label': t('clipStrip') });
  private mini = h('canvas', { class: 'mini-timeline', 'aria-label': t('viewTimeline') });
  private tiles = new Map<string, { tile: HTMLElement; canvas: HTMLCanvasElement; placement: Placement }>();
  private style = getComputedStyle(document.documentElement);
  private queued = false;

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    this.element = h('section', { class: 'clip-strip', id: 'clip-strip' }, this.row, this.mini);
    session.store.on('change', () => this.schedule());
    session.on('thumbnails', () => this.paintThumbs());
    selection.on('change', () => this.mark());
    session.transport.on('time', () => {
      this.mark();
      this.paintMini();
    });
    new ResizeObserver(() => this.paintMini()).observe(this.mini);
    this.mini.addEventListener('pointerdown', (e) => {
      this.mini.setPointerCapture(e.pointerId);
      this.scrub(e);
    });
    this.mini.addEventListener('pointermove', (e) => this.mini.hasPointerCapture(e.pointerId) && this.scrub(e));
    this.render();
  }

  private get placements(): readonly Placement[] {
    const track = this.session.store.project.tracks.find((tr) => tr.id === this.session.videoTrackId);
    return track ? placeTrack(track).filter((p) => p.item.kind === 'media' || p.item.kind === 'text') : [];
  }

  private schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private render() {
    const { project } = this.session.store;
    const fps = project.settings?.fps ?? 25;
    this.tiles.clear();
    this.row.replaceChildren(...this.placements.map((placement, i) => {
      const { item } = placement;
      const canvas = h('canvas', { width: THUMB_WIDTH * 2, height: THUMB_HEIGHT * 2 });
      const asset = item.kind === 'media' ? project.assets[item.source.assetId] : undefined;
      const tile = h('button', {
        type: 'button',
        class: 'clip-tile',
        role: 'option',
        dataset: { item: item.id },
        title: asset?.name ?? '',
        onClick: () => {
          this.selection.set(item.id);
          this.session.transport.seek(placement.start + 1e-3);
        },
      },
        h('span', { class: 'clip-tile-head' }, h('b', {}, String(i + 1).padStart(2, '0')), h('span', {}, formatTimecode(placement.start, fps)), h('span', { class: 'track' }, placement.track.id.toUpperCase())),
        canvas,
        h('span', { class: 'clip-tile-foot' }, asset ? asset.codec : t('titleTag')),
      );
      this.tiles.set(item.id, { tile, canvas, placement });
      return tile;
    }));
    this.paintThumbs();
    this.mark();
    this.paintMini();
  }

  private paintThumbs() {
    const { project } = this.session.store;
    for (const { canvas, placement } of this.tiles.values()) {
      const { item } = placement;
      if (item.kind !== 'media') continue;
      const strip = this.session.thumbnails(item.source.assetId);
      if (!strip) continue;
      const at = item.source.in + Math.min(1, (placement.end - placement.start) / 2);
      const index = Math.min(strip.frames.length - 1, Math.max(0, Math.floor((at - strip.start) / strip.interval)));
      const frame = strip.frames[index] ?? strip.frames.find((f) => f);
      if (!frame || !project.assets[item.source.assetId]) continue;
      const g = canvas.getContext('2d')!;
      const scale = Math.max(canvas.width / frame.width, canvas.height / frame.height);
      g.drawImage(frame, (canvas.width - frame.width * scale) / 2, (canvas.height - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
    }
  }

  private mark() {
    const time = this.session.transport.time;
    for (const [id, { tile, placement }] of this.tiles) {
      tile.setAttribute('aria-selected', String(id === this.selection.id));
      tile.classList.toggle('current', time >= placement.start && time < placement.end);
    }
  }

  private color(name: string) {
    return this.style.getPropertyValue(name).trim();
  }

  private paintMini() {
    const c = this.mini;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) [c.width, c.height] = [Math.round(w * dpr), Math.round(hgt * dpr)];
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const { project } = this.session.store;
    const duration = Math.max(1, projectDuration(project));
    const x = (time: number) => (time / duration) * w;
    const lanes = project.tracks.filter((tr) => tr.kind === 'video').reverse();
    const laneHeight = Math.max(3, Math.min(8, (hgt - 4) / Math.max(1, lanes.length) - 2));
    lanes.forEach((track, row) => {
      const y = 2 + row * (laneHeight + 2);
      for (const p of placeTrack(track)) {
        g.fillStyle = this.color(p.item.id === this.selection.id ? '--accent' : p.item.kind === 'text' ? '--muted' : '--clip-selected');
        g.fillRect(x(p.start) + 1, y, Math.max(1, x(p.end) - x(p.start) - 2), laneHeight);
      }
    });
    g.fillStyle = this.color('--playhead');
    g.fillRect(Math.round(x(this.session.transport.time)), 0, 2, hgt);
  }

  private scrub(e: PointerEvent) {
    const r = this.mini.getBoundingClientRect();
    const duration = projectDuration(this.session.store.project);
    this.session.transport.seek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
  }
}
