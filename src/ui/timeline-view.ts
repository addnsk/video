import type { Project, Track } from '../core/model';
import { moveItem, trimItem } from '../core/operations';
import type { Store } from '../core/store';
import { placeTrack, projectDuration, type Placement } from '../core/timeline';
import type { Transport } from '../host/transport';
import { t } from '../i18n';
import { formatTimecode } from './dom';
import type { Selection } from './selection';

const RULER = 26;
const LANE_GAP = 6;
const LANE_HEIGHT: Record<Track['kind'], number> = { video: 60, audio: 34 };
const MIN_PPS = 2;
const MAX_PPS = 800;
const STEPS = [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

type Drag =
  | { kind: 'scrub' }
  | { kind: 'pan'; x0: number; scroll0: number }
  | { kind: 'trim'; placement: Placement; edge: 'in' | 'out'; x0: number; origin: number }
  | { kind: 'move'; placement: Placement; x0: number; moved: boolean; drop: number; x: number };

interface Lane {
  track: Track;
  top: number;
  height: number;
}

export class TimelineView {
  private pps = 40;
  private scroll = 0;
  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; pps: number } | null = null;
  private style = getComputedStyle(document.documentElement);
  private queued = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private transport: Transport,
    private selection: Selection,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    store.on('change', () => this.draw());
    selection.on('change', () => this.draw());
    transport.on('time', (time) => {
      if (transport.playing) this.follow(time);
      this.draw();
    });
  }

  private get project(): Project {
    return this.store.project;
  }

  private color(name: string): string {
    return this.style.getPropertyValue(name).trim();
  }

  private x(time: number) {
    return time * this.pps - this.scroll;
  }

  private time(x: number) {
    return (x + this.scroll) / this.pps;
  }

  private lanes(): Lane[] {
    let top = RULER + LANE_GAP;
    return this.project.tracks.map((track) => {
      const lane = { track, top, height: LANE_HEIGHT[track.kind] };
      top += lane.height + LANE_GAP;
      return lane;
    });
  }

  zoom(factor: number, anchor = this.canvas.clientWidth / 2): void {
    const at = this.time(anchor);
    this.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, this.pps * factor));
    this.scroll = Math.max(0, at * this.pps - anchor);
    this.draw();
  }

  fit(): void {
    const duration = projectDuration(this.project);
    if (duration > 0) this.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, (this.canvas.clientWidth - 40) / duration));
    this.scroll = 0;
    this.draw();
  }

  private follow(time: number) {
    const x = this.x(time);
    if (x > this.canvas.clientWidth - 40 || x < 0) this.scroll = Math.max(0, time * this.pps - 40);
  }

  private hit(x: number, y: number): { placement: Placement; edge: 'in' | 'out' | null } | null {
    const lane = this.lanes().find((l) => y >= l.top && y <= l.top + l.height);
    if (!lane) return null;
    const grab = matchMedia('(pointer: coarse)').matches ? 16 : 7;
    const placements = placeTrack(lane.track);
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      const x0 = this.x(p.start);
      const x1 = this.x(p.end);
      if (x < x0 - 2 || x > x1 + 2) continue;
      const g = Math.min(grab, (x1 - x0) / 3);
      return { placement: p, edge: x - x0 < g ? 'in' : x1 - x < g ? 'out' : null };
    }
    return null;
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), pps: this.pps };
      this.drag = null;
      return;
    }
    if (p.y < RULER) {
      this.drag = { kind: 'scrub' };
      this.transport.seek(this.time(p.x));
      return;
    }
    const hit = this.hit(p.x, p.y);
    if (!hit) {
      this.drag = { kind: 'pan', x0: p.x, scroll0: this.scroll };
      return;
    }
    this.selection.set(hit.placement.item.id);
    const { item } = hit.placement;
    this.drag = hit.edge
      ? { kind: 'trim', placement: hit.placement, edge: hit.edge, x0: p.x, origin: hit.edge === 'in' ? item.source.in : item.source.out }
      : { kind: 'move', placement: hit.placement, x0: p.x, moved: false, drop: -1, x: p.x };
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const target = this.pinch.pps * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.distance);
      this.zoom(target / this.pps, (a.x + b.x) / 2);
      return;
    }
    const d = this.drag;
    if (!d) {
      const hit = this.hit(p.x, p.y);
      this.canvas.style.cursor = p.y < RULER ? 'col-resize' : hit?.edge ? 'ew-resize' : hit ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'scrub') this.transport.seek(this.time(p.x));
    else if (d.kind === 'pan') {
      this.scroll = Math.max(0, d.scroll0 - (p.x - d.x0));
      this.draw();
    } else if (d.kind === 'trim') {
      const value = d.origin + (p.x - d.x0) / this.pps;
      const id = d.placement.item.id;
      this.store.dispatch(trimItem(id, d.edge === 'in' ? { in: value } : { out: value }), { coalesce: `trim:${id}:${d.edge}` });
      const track = this.project.tracks.find((tr) => tr.id === d.placement.track.id)!;
      const placed = placeTrack(track).find((x) => x.item.id === id);
      if (placed) this.transport.seek(d.edge === 'in' ? placed.start : placed.end - 1e-3);
    } else if (d.kind === 'move') {
      if (!d.moved && Math.abs(p.x - d.x0) < 6) return;
      d.moved = true;
      d.x = p.x;
      const at = this.time(p.x);
      const track = this.project.tracks.find((t) => t.id === d.placement.track.id)!;
      d.drop = placeTrack(track).filter((x) => x.item.id !== d.placement.item.id && at > (x.start + x.end) / 2).length;
      this.draw();
    }
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'move') {
      if (d.moved && d.drop >= 0) this.store.dispatch(moveItem(d.placement.item.id, d.drop));
      else this.transport.seek(this.time(this.local(e).x));
    }
    this.draw();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.01), this.local(e).x);
    else {
      this.scroll = Math.max(0, this.scroll + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
      this.draw();
    }
  }

  draw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  private paint() {
    const c = this.canvas;
    const dpr = devicePixelRatio || 1;
    const lanes = this.lanes();
    const height = (lanes.at(-1)?.top ?? RULER) + (lanes.at(-1)?.height ?? 0) + LANE_GAP;
    if (c.style.height !== `${height}px`) c.style.height = `${height}px`;
    const w = c.clientWidth;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(height * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = this.color('--tl-bg');
    g.fillRect(0, 0, w, height);
    this.paintRuler(g, w);
    for (const lane of lanes) this.paintLane(g, lane, w);
    if (!lanes.some((l) => l.track.items.length)) {
      g.fillStyle = this.color('--muted');
      g.font = '13px "IBM Plex Sans", system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(t('timelineEmpty'), 16, lanes[0].top + lanes[0].height / 2);
    }
    const px = Math.round(this.x(this.transport.time)) + 0.5;
    g.fillStyle = this.color('--playhead');
    g.fillRect(px - 0.5, 0, 2, height);
    g.beginPath();
    g.moveTo(px - 6, 0);
    g.lineTo(px + 7, 0);
    g.lineTo(px + 0.5, 9);
    g.fill();
  }

  private paintRuler(g: CanvasRenderingContext2D, width: number) {
    g.fillStyle = this.color('--panel');
    g.fillRect(0, 0, width, RULER);
    g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    const step = STEPS.find((s) => s * this.pps >= 80) ?? 2400;
    const fps = this.project.settings?.fps ?? 25;
    for (let time = Math.floor(this.time(0) / step) * step; this.x(time) < width; time += step) {
      const x = Math.round(this.x(time)) + 0.5;
      g.fillStyle = this.color('--line');
      g.fillRect(x, RULER - 8, 1, 8);
      g.fillStyle = this.color('--muted');
      g.fillText(formatTimecode(time, fps), x + 4, RULER / 2 - 1);
    }
  }

  private paintLane(g: CanvasRenderingContext2D, lane: Lane, width: number) {
    g.fillStyle = this.color('--lane');
    g.fillRect(0, lane.top, width, lane.height);
    const drag = this.drag?.kind === 'move' && this.drag.moved ? this.drag : null;
    for (const p of placeTrack(lane.track)) {
      const x0 = this.x(p.start);
      const x1 = this.x(p.end);
      if (x1 < 0 || x0 > width) continue;
      const asset = this.project.assets[p.item.source.assetId];
      const selected = p.item.id === this.selection.id;
      g.globalAlpha = drag && drag.placement.item.id === p.item.id ? 0.35 : 1;
      g.fillStyle = this.color(selected ? '--clip-selected' : '--clip');
      g.beginPath();
      g.roundRect(x0 + 1, lane.top, Math.max(0, x1 - x0 - 2), lane.height, 4);
      g.fill();
      const graded = p.item.effects.some((e) => e.enabled);
      g.fillStyle = this.color(graded ? '--accent' : '--clip-band');
      g.fillRect(x0 + 1, lane.top + lane.height - 5, Math.max(0, x1 - x0 - 2), 5);
      if (selected) {
        g.strokeStyle = this.color('--accent');
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(x0 + 2, lane.top + 1, Math.max(0, x1 - x0 - 4), lane.height - 2, 4);
        g.stroke();
      }
      g.save();
      g.beginPath();
      g.rect(x0 + 6, lane.top, Math.max(0, x1 - x0 - 12), lane.height);
      g.clip();
      g.textBaseline = 'middle';
      g.fillStyle = this.color('--fg');
      g.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
      g.fillText(asset?.name ?? '', x0 + 8, lane.top + 15);
      g.fillStyle = this.color('--muted');
      g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText(`${asset?.codec ?? ''} · ${(p.end - p.start).toFixed(2)}s`, x0 + 8, lane.top + 32);
      g.restore();
      if (p.fadeIn > 0) this.paintTransition(g, lane, x0, this.x(p.start + p.fadeIn));
      g.globalAlpha = 1;
    }
    if (drag && lane.track.id === drag.placement.track.id) {
      const others = placeTrack(lane.track).filter((x) => x.item.id !== drag.placement.item.id);
      const at = drag.drop > 0 ? others[drag.drop - 1].end : 0;
      g.fillStyle = this.color('--accent');
      g.fillRect(this.x(at) - 1.5, lane.top - 4, 3, lane.height + 8);
    }
  }

  private paintTransition(g: CanvasRenderingContext2D, lane: Lane, x0: number, x1: number) {
    g.save();
    g.beginPath();
    g.rect(x0 + 1, lane.top, x1 - x0, lane.height);
    g.clip();
    g.fillStyle = this.color('--transition');
    g.fillRect(x0, lane.top, x1 - x0, lane.height);
    g.strokeStyle = this.color('--accent');
    g.lineWidth = 1;
    for (let k = x0 - lane.height; k < x1; k += 8) {
      g.beginPath();
      g.moveTo(k, lane.top + lane.height);
      g.lineTo(k + lane.height, lane.top);
      g.stroke();
    }
    g.restore();
  }
}
