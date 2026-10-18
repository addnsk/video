import type { Item, Project, Track } from '../core/model';
import { accepts, itemLength } from '../core/model';
import { moveItem, moveToTrack, setTrackMuted, trimItem } from '../core/operations';
import { placeTrack, projectDuration, type Placement } from '../core/timeline';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { formatTimecode } from './dom';
import type { Selection } from './selection';

const RULER = 26;
const GUTTER = 44;
const LANE_GAP = 4;
const LANE_HEIGHT: Record<Track['kind'], number> = { video: 56, audio: 40 };
const MIN_PPS = 2;
const MAX_PPS = 800;
const SNAP_PX = 8;
const STEPS = [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
const PEAK_RATE = 100;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'pan'; x0: number; scroll0: number }
  | { kind: 'trim'; placement: Placement; edge: 'in' | 'out'; x0: number; origin: number }
  | { kind: 'move'; placement: Placement; x0: number; y: number; moved: boolean; drop: number; start: number; lane: Lane | null };

interface Lane {
  track: Track;
  top: number;
  height: number;
  label: string;
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
    private session: EditorSession,
    private selection: Selection,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    session.store.on('change', () => this.draw());
    session.on('peaks', () => this.draw());
    selection.on('change', () => this.draw());
    session.transport.on('time', (time) => {
      if (session.transport.playing) this.follow(time);
      this.draw();
    });
  }

  private get project(): Project {
    return this.session.store.project;
  }

  private get transport() {
    return this.session.transport;
  }

  private color(name: string): string {
    return this.style.getPropertyValue(name).trim();
  }

  private x(time: number) {
    return GUTTER + time * this.pps - this.scroll;
  }

  private time(x: number) {
    return (x - GUTTER + this.scroll) / this.pps;
  }

  private lanes(): Lane[] {
    const video = this.project.tracks.filter((t) => t.kind === 'video').reverse();
    const audio = this.project.tracks.filter((t) => t.kind === 'audio');
    let top = RULER + LANE_GAP;
    const out: Lane[] = [];
    const add = (track: Track, label: string) => {
      out.push({ track, top, height: LANE_HEIGHT[track.kind], label });
      top += LANE_HEIGHT[track.kind] + LANE_GAP;
    };
    video.forEach((track, i) => add(track, `V${video.length - i}`));
    audio.forEach((track, i) => add(track, `A${i + 1}`));
    return out;
  }

  zoom(factor: number, anchor = this.canvas.clientWidth / 2): void {
    const at = this.time(anchor);
    this.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, this.pps * factor));
    this.scroll = Math.max(0, at * this.pps - (anchor - GUTTER));
    this.draw();
  }

  fit(): void {
    const duration = projectDuration(this.project);
    if (duration > 0) this.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, (this.canvas.clientWidth - GUTTER - 40) / duration));
    this.scroll = 0;
    this.draw();
  }

  private follow(time: number) {
    const x = this.x(time);
    if (x > this.canvas.clientWidth - 40 || x < GUTTER) this.scroll = Math.max(0, time * this.pps - 40);
  }

  private laneAt(y: number): Lane | null {
    return this.lanes().find((l) => y >= l.top && y <= l.top + l.height) ?? null;
  }

  private hit(x: number, y: number): { placement: Placement; edge: 'in' | 'out' | null } | null {
    const lane = this.laneAt(y);
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
    if (p.x < GUTTER) {
      const lane = this.laneAt(p.y);
      if (lane) this.session.store.dispatch(setTrackMuted(lane.track.id, !lane.track.muted));
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
    if (hit.edge) {
      const origin = hit.edge === 'in' ? (item.kind === 'media' ? item.source.in : 0) : item.kind === 'media' ? item.source.out : item.duration;
      this.drag = { kind: 'trim', placement: hit.placement, edge: hit.edge, x0: p.x, origin };
    } else {
      this.drag = { kind: 'move', placement: hit.placement, x0: p.x, y: p.y, moved: false, drop: -1, start: hit.placement.start, lane: null };
    }
  }

  private snap(time: number, ignore: string): number {
    const candidates = [this.transport.time, 0];
    for (const track of this.project.tracks)
      for (const p of placeTrack(track)) if (p.item.id !== ignore) candidates.push(p.start, p.end);
    let best = time;
    let distance = SNAP_PX / this.pps;
    for (const c of candidates) {
      if (Math.abs(c - time) < distance) [best, distance] = [c, Math.abs(c - time)];
    }
    return best;
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
      this.canvas.style.cursor = p.x < GUTTER ? 'pointer' : p.y < RULER ? 'col-resize' : hit?.edge ? 'ew-resize' : hit ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'scrub') this.transport.seek(this.time(p.x));
    else if (d.kind === 'pan') {
      this.scroll = Math.max(0, d.scroll0 - (p.x - d.x0));
      this.draw();
    } else if (d.kind === 'trim') {
      const value = d.origin + (p.x - d.x0) / this.pps;
      const id = d.placement.item.id;
      this.session.store.dispatch(trimItem(id, d.edge === 'in' ? { in: value } : { out: value }), { coalesce: `trim:${id}:${d.edge}` });
      const track = this.project.tracks.find((tr) => tr.id === d.placement.track.id)!;
      const placed = placeTrack(track).find((x) => x.item.id === id);
      if (placed) this.transport.seek(d.edge === 'in' ? placed.start : placed.end - 1e-3);
    } else if (d.kind === 'move') {
      if (!d.moved && Math.abs(p.x - d.x0) < 6 && Math.abs(p.y - d.y) < 6) return;
      d.moved = true;
      const lane = this.laneAt(p.y);
      d.lane = lane && accepts(lane.track, d.placement.item, this.project.assets) ? lane : null;
      const target = d.lane?.track ?? d.placement.track;
      const raw = d.placement.start + (p.x - d.x0) / this.pps;
      const length = itemLength(d.placement.item);
      const snapped = this.snap(raw, d.placement.item.id);
      const snappedEnd = this.snap(raw + length, d.placement.item.id);
      d.start = Math.max(0, snapped !== raw ? snapped : snappedEnd - length);
      if (target.magnetic) {
        const at = this.time(p.x);
        d.drop = placeTrack(target).filter((x) => x.item.id !== d.placement.item.id && at > (x.start + x.end) / 2).length;
      }
      this.draw();
    }
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'move') {
      if (!d.moved) this.transport.seek(this.time(this.local(e).x));
      else {
        const target = d.lane?.track ?? d.placement.track;
        const id = d.placement.item.id;
        if (target.id === d.placement.track.id && target.magnetic) this.session.store.dispatch(moveItem(id, d.drop));
        else this.session.store.dispatch(moveToTrack(id, target.id, target.magnetic ? { index: d.drop } : { start: d.start }));
      }
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
    const last = lanes.at(-1);
    const height = (last ? last.top + last.height : RULER) + LANE_GAP;
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
    this.paintGhost(g);
    if (!this.project.tracks.some((tr) => tr.items.length)) {
      const main = lanes.find((l) => l.track.magnetic)!;
      g.fillStyle = this.color('--muted');
      g.font = '13px "IBM Plex Sans", system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(t('timelineEmpty'), GUTTER + 12, main.top + main.height / 2);
    }
    for (const lane of lanes) this.paintHeader(g, lane);
    const px = Math.round(this.x(this.transport.time)) + 0.5;
    if (px >= GUTTER) {
      g.fillStyle = this.color('--playhead');
      g.fillRect(px - 0.5, 0, 2, height);
      g.beginPath();
      g.moveTo(px - 6, 0);
      g.lineTo(px + 7, 0);
      g.lineTo(px + 0.5, 9);
      g.fill();
    }
  }

  private paintRuler(g: CanvasRenderingContext2D, width: number) {
    g.fillStyle = this.color('--panel');
    g.fillRect(0, 0, width, RULER);
    g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    const step = STEPS.find((s) => s * this.pps >= 80) ?? 2400;
    const fps = this.project.settings?.fps ?? 25;
    for (let time = Math.max(0, Math.floor(this.time(GUTTER) / step) * step); this.x(time) < width; time += step) {
      const x = Math.round(this.x(time)) + 0.5;
      g.fillStyle = this.color('--line');
      g.fillRect(x, RULER - 8, 1, 8);
      g.fillStyle = this.color('--muted');
      g.fillText(formatTimecode(time, fps), x + 4, RULER / 2 - 1);
    }
  }

  private paintHeader(g: CanvasRenderingContext2D, lane: Lane) {
    g.fillStyle = this.color('--panel');
    g.fillRect(0, lane.top, GUTTER - 2, lane.height);
    g.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    g.fillStyle = this.color(lane.track.muted ? '--danger' : '--muted');
    g.fillText(lane.track.muted ? `${lane.label}×` : lane.label, 8, lane.top + lane.height / 2);
  }

  private paintLane(g: CanvasRenderingContext2D, lane: Lane, width: number) {
    g.fillStyle = this.color('--lane');
    g.fillRect(GUTTER, lane.top, width - GUTTER, lane.height);
    g.globalAlpha = lane.track.muted ? 0.4 : 1;
    const moving = this.drag?.kind === 'move' && this.drag.moved ? this.drag.placement.item.id : null;
    for (const p of placeTrack(lane.track)) {
      const x0 = this.x(p.start);
      const x1 = this.x(p.end);
      if (x1 < GUTTER || x0 > width) continue;
      const alpha = g.globalAlpha;
      if (p.item.id === moving) g.globalAlpha = alpha * 0.35;
      this.paintItem(g, lane, p, x0, x1);
      g.globalAlpha = alpha;
    }
    g.globalAlpha = 1;
  }

  private paintItem(g: CanvasRenderingContext2D, lane: Lane, p: Placement, x0: number, x1: number) {
    const { item } = p;
    const selected = item.id === this.selection.id;
    const top = lane.top;
    const h = lane.height;
    const w = Math.max(0, x1 - x0 - 2);
    g.fillStyle = this.color(item.kind === 'text' ? '--clip-text' : lane.track.kind === 'audio' ? '--clip-audio' : selected ? '--clip-selected' : '--clip');
    g.beginPath();
    g.roundRect(x0 + 1, top, w, h, 4);
    g.fill();
    if (item.kind === 'media') this.paintWaveform(g, item, lane, x0, x1);
    if (item.effects.some((e) => e.enabled)) {
      g.fillStyle = this.color('--accent');
      g.fillRect(x0 + 1, top + h - 4, w, 4);
    }
    if (p.fadeIn > 0) this.paintTransition(g, lane, x0, this.x(p.start + p.fadeIn));
    if (selected) {
      g.strokeStyle = this.color('--accent');
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x0 + 2, top + 1, Math.max(0, x1 - x0 - 4), h - 2, 4);
      g.stroke();
      this.paintKeyframes(g, item, lane, p.start);
    }
    g.save();
    g.beginPath();
    g.rect(x0 + 6, top, Math.max(0, x1 - x0 - 12), h);
    g.clip();
    g.textBaseline = 'middle';
    g.fillStyle = this.color('--fg');
    g.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
    const label = item.kind === 'media' ? (this.project.assets[item.source.assetId]?.name ?? '') : `T  ${item.text.content.split('\n')[0]}`;
    g.fillText(label, x0 + 8, top + 13);
    if (h > 44) {
      g.fillStyle = this.color('--muted');
      g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText(`${(p.end - p.start).toFixed(2)}s`, x0 + 8, top + 29);
    }
    g.restore();
  }

  private paintWaveform(g: CanvasRenderingContext2D, item: Extract<Item, { kind: 'media' }>, lane: Lane, x0: number, x1: number) {
    const peaks = this.session.peaks(item.source.assetId);
    if (!peaks?.length) return;
    const band = lane.track.kind === 'audio' ? lane.height - 18 : 16;
    const mid = lane.top + lane.height - 4 - band / 2;
    g.fillStyle = this.color('--waveform');
    const from = Math.max(x0, GUTTER);
    const to = Math.min(x1, this.canvas.clientWidth);
    const volume = item.volume;
    for (let x = Math.floor(from); x < to; x++) {
      const source = item.source.in + (x - x0) / this.pps;
      const span = Math.max(1, Math.round(PEAK_RATE / this.pps));
      const index = Math.floor(source * PEAK_RATE);
      let peak = 0;
      for (let k = 0; k < span; k++) peak = Math.max(peak, peaks[index + k] ?? 0);
      const amp = Math.min(1, Math.sqrt(peak * volume)) * (band / 2);
      if (amp > 0.3) g.fillRect(x, mid - amp, 1, amp * 2);
    }
  }

  private paintKeyframes(g: CanvasRenderingContext2D, item: Item, lane: Lane, start: number) {
    const times = new Set<number>();
    for (const keys of Object.values(item.animations)) for (const k of keys) times.add(k.t);
    g.fillStyle = this.color('--keyframe');
    const y = lane.top + lane.height - 10;
    for (const time of times) {
      const x = this.x(start + time);
      g.beginPath();
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 5);
      g.lineTo(x - 5, y);
      g.fill();
    }
  }

  private paintGhost(g: CanvasRenderingContext2D) {
    const d = this.drag;
    if (d?.kind !== 'move' || !d.moved) return;
    const lane = d.lane ?? this.lanes().find((l) => l.track.id === d.placement.track.id)!;
    g.fillStyle = this.color('--accent');
    if (lane.track.magnetic) {
      const others = placeTrack(lane.track).filter((x) => x.item.id !== d.placement.item.id);
      const at = d.drop > 0 ? others[d.drop - 1].end : 0;
      g.fillRect(this.x(at) - 1.5, lane.top - 3, 3, lane.height + 6);
      return;
    }
    const x0 = this.x(d.start);
    const x1 = this.x(d.start + itemLength(d.placement.item));
    g.globalAlpha = 0.5;
    g.beginPath();
    g.roundRect(x0, lane.top, Math.max(2, x1 - x0), lane.height, 4);
    g.fill();
    g.globalAlpha = 1;
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
