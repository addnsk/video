import type { Item, Project, Track } from '../core/model';
import { accepts, itemLength, sourceTimeAt } from '../core/model';
import { createId } from '../core/ids';
import { createMediaItem, moveItem, moveToTrack, placeItem, setTrackMuted, trimItem } from '../core/operations';
import { placeTrack, projectDuration, type Placement } from '../core/timeline';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { formatTimecode } from './dom';
import type { DropPoint, DropTarget } from './drop-target';
import type { Selection } from './selection';
import type { TrimTool } from './edit-controls';
import { rippleTrim, rollEdit, slideEdit, slipEdit, linkedIds } from '../core/editing';

const RULER = 32;
const GUTTER = 52;
const LANE_GAP = 8;
const LANE_HEIGHT: Record<Track['kind'], number> = { video: 60, audio: 44 };
const RADIUS = 10;
const UI_FONT = '"Inter", system-ui, sans-serif';
const TRACK_ICONS = { video: new Path2D('M5 6h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6zM15.5 10.5l6-3.5v10l-6-3.5'), audio: new Path2D('M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'), text: new Path2D('M5 6V4h14v2M12 4v16M9 20h6') };
const MIN_PPS = 2;
const MAX_PPS = 800;
const SNAP_PX = 8;
const STEPS = [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
const PEAK_RATE = 100;
export const MARKER_PAINT: Record<string, string> = {
  blue: '#3b82f6', cyan: '#06b6d4', green: '#22c55e', yellow: '#eab308', red: '#ef4444', pink: '#ec4899', purple: '#a855f7', fuchsia: '#d946ef',
  rose: '#fb7185', lavender: '#c4b5fd', sky: '#7dd3fc', mint: '#6ee7b7', lemon: '#fde047', sand: '#d6c08f', cocoa: '#8b5e3c', cream: '#f5ecd7',
};

function rulerLabel(time: number, step: number, fps: number): string {
  if (step < 1) return step < 0.2 ? `${Math.floor(time)}s ${Math.round((time % 1) * fps)}f` : `${+time.toFixed(1)}s`;
  const total = Math.round(time);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m${total % 60 ? ` ${String(total % 60).padStart(2, '0')}s` : ''}`;
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'pan'; x0: number; scroll0: number }
  | { kind: 'trim'; placement: Placement; edge: 'in' | 'out'; x0: number; origin: number }
  | { kind: 'move'; placement: Placement; x0: number; y: number; moved: boolean }
  | { kind: 'edit'; tool: Exclude<TrimTool, 'select'>; placement: Placement; edge: 'in' | 'out' | null; x0: number; base: Project };

interface Lane {
  track: Track;
  top: number;
  height: number;
  label: string;
}

interface Ghost {
  item: Item;
  ignore: string | null;
  lane: Lane;
  start: number;
  drop: number;
}

export class TimelineView implements DropTarget {
  private pps = 40;
  private scroll = 0;
  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private ghost: Ghost | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; pps: number } | null = null;
  private style = getComputedStyle(document.documentElement);
  private queued = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private session: EditorSession,
    private selection: Selection,
    private tool: () => TrimTool = () => 'select',
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    session.store.on('change', () => this.draw());
    session.marks.on('change', () => this.draw());
    session.on('peaks', () => this.draw());
    session.on('thumbnails', () => this.draw());
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
    const inside = (slack: number) => {
      for (let i = placements.length - 1; i >= 0; i--) {
        const p = placements[i];
        if (x >= this.x(p.start) - slack && x <= this.x(p.end) + slack) return p;
      }
      return null;
    };
    const p = inside(0) ?? inside(2);
    if (!p) return null;
    const x0 = this.x(p.start);
    const x1 = this.x(p.end);
    const g = Math.min(grab, (x1 - x0) / 3);
    return { placement: p, edge: x - x0 < g ? 'in' : x1 - x < g ? 'out' : null };
  }

  private local(e: DropPoint) {
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
    const tool = this.tool();
    if (tool !== 'select') {
      const edge = tool === 'slip' || tool === 'slide' ? null : hit.edge;
      if ((tool === 'ripple' || tool === 'roll') && !edge) this.drag = { kind: 'pan', x0: p.x, scroll0: this.scroll };
      else this.drag = { kind: 'edit', tool, placement: hit.placement, edge, x0: p.x, base: this.project };
      return;
    }
    if (hit.edge) {
      const origin = hit.edge === 'in' ? (item.kind === 'media' ? item.source.in : 0) : item.kind === 'media' ? item.source.out : item.duration;
      this.drag = { kind: 'trim', placement: hit.placement, edge: hit.edge, x0: p.x, origin };
    } else {
      this.drag = { kind: 'move', placement: hit.placement, x0: p.x, y: p.y, moved: false };
    }
  }

  private snap(time: number, ignore: string | null): number {
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
      const tool = this.tool();
      const body = tool === 'slip' || tool === 'slide' ? 'ew-resize' : 'grab';
      this.canvas.style.cursor = p.x < GUTTER ? 'pointer' : p.y < RULER ? 'col-resize' : hit?.edge && tool !== 'slip' && tool !== 'slide' ? (tool === 'roll' ? 'col-resize' : 'ew-resize') : hit ? body : 'default';
      return;
    }
    if (d.kind === 'scrub') this.transport.seek(this.time(p.x));
    else if (d.kind === 'pan') {
      this.scroll = Math.max(0, d.scroll0 - (p.x - d.x0));
      this.draw();
    } else if (d.kind === 'trim') {
      const item = d.placement.item;
      const value = d.origin + ((p.x - d.x0) / this.pps) * (item.kind === 'media' ? item.speed : 1);
      const id = d.placement.item.id;
      this.session.store.dispatch(trimItem(id, d.edge === 'in' ? { in: value } : { out: value }), { coalesce: `trim:${id}:${d.edge}` });
      const track = this.project.tracks.find((tr) => tr.id === d.placement.track.id)!;
      const placed = placeTrack(track).find((x) => x.item.id === id);
      if (placed) this.transport.seek(d.edge === 'in' ? placed.start : placed.end - 1e-3);
    } else if (d.kind === 'edit') {
      const fps = this.project.settings?.fps ?? 25;
      const delta = Math.round(((p.x - d.x0) / this.pps) * fps) / fps;
      const id = d.placement.item.id;
      const op =
        d.tool === 'ripple' ? rippleTrim(id, d.edge!, delta) : d.tool === 'roll' ? rollEdit(id, d.edge!, delta) : d.tool === 'slip' ? slipEdit(id, delta) : slideEdit(id, delta);
      this.session.store.dispatch(() => op(d.base), { coalesce: `edit:${d.tool}:${id}:${d.x0}` });
      const placed = placeTrack(this.project.tracks.find((tr) => tr.id === d.placement.track.id)!).find((x) => x.item.id === id);
      if (placed) this.transport.seek(d.edge === 'out' ? placed.end - 1e-3 : placed.start);
    } else if (d.kind === 'move') {
      if (!d.moved && Math.abs(p.x - d.x0) < 6 && Math.abs(p.y - d.y) < 6) return;
      d.moved = true;
      const { item, start, track } = d.placement;
      this.ghost = this.target(p, item, start + (p.x - d.x0) / this.pps, item.id, track);
      this.draw();
    }
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    const ghost = this.ghost;
    this.ghost = null;
    if (d?.kind === 'move') {
      if (!d.moved) this.transport.seek(this.time(this.local(e).x));
      else if (ghost) {
        const target = ghost.lane.track;
        const id = d.placement.item.id;
        if (target.id === d.placement.track.id && target.magnetic) this.session.store.dispatch(moveItem(id, ghost.drop));
        else this.session.store.dispatch(moveToTrack(id, target.id, target.magnetic ? { index: ghost.drop } : { start: ghost.start }));
      }
    }
    this.draw();
  }

  private target(p: { x: number; y: number }, item: Item, raw: number, ignore: string | null, home: Track | null): Ghost | null {
    const hovered = this.laneAt(p.y);
    const lane =
      hovered && accepts(hovered.track, item, this.project.assets) ? hovered : (home && this.lanes().find((l) => l.track.id === home.id)) || null;
    if (!lane) return null;
    const length = itemLength(item);
    const snapped = this.snap(raw, ignore);
    const snappedEnd = this.snap(raw + length, ignore);
    const start = Math.max(0, snapped !== raw ? snapped : snappedEnd - length);
    const at = this.time(p.x);
    const drop = lane.track.magnetic ? placeTrack(lane.track).filter((x) => x.item.id !== ignore && at > (x.start + x.end) / 2).length : -1;
    return { item, ignore, lane, start, drop };
  }

  hover(point: DropPoint, assetId: string): boolean {
    const r = this.canvas.getBoundingClientRect();
    const asset = this.project.assets[assetId];
    const inside = point.clientX >= r.left && point.clientX <= r.right && point.clientY >= r.top && point.clientY <= r.bottom;
    const p = this.local(point);
    this.ghost = inside && asset && p.x >= GUTTER ? this.target(p, createMediaItem(asset), this.time(p.x), null, null) : null;
    this.draw();
    return !!this.ghost;
  }

  drop(point: DropPoint, assetId: string): string | null {
    const ghost = this.hover(point, assetId) ? this.ghost : null;
    this.ghost = null;
    this.draw();
    if (!ghost) return null;
    const item = { ...ghost.item, id: createId('item') };
    const track = ghost.lane.track;
    this.session.store.dispatch(placeItem(item, track.id, track.magnetic ? { index: ghost.drop } : { start: ghost.start }));
    this.selection.set(item.id);
    return item.id;
  }

  leave(): void {
    if (!this.ghost) return;
    this.ghost = null;
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
      this.canvas.dataset.pps = String(this.pps);
      this.canvas.dataset.scroll = String(this.scroll);
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
    this.paintMarks(g, height);
    if (!this.project.tracks.some((tr) => tr.items.length)) {
      const main = lanes.find((l) => l.track.magnetic)!;
      g.fillStyle = this.color('--muted');
      g.font = `13px ${UI_FONT}`;
      g.textBaseline = 'middle';
      g.fillText(t('timelineEmpty'), GUTTER + 12, main.top + main.height / 2);
    }
    for (const lane of lanes) this.paintHeader(g, lane);
    const px = Math.round(this.x(this.transport.time)) + 0.5;
    if (px >= GUTTER) {
      g.fillStyle = this.color('--playhead');
      g.fillRect(px - 0.5, RULER / 2, 2, height - RULER / 2);
      g.beginPath();
      g.moveTo(px + 0.5, RULER / 2 - 6);
      g.lineTo(px + 6.5, RULER / 2);
      g.lineTo(px + 0.5, RULER / 2 + 6);
      g.lineTo(px - 5.5, RULER / 2);
      g.fill();
    }
  }

  private paintMarks(g: CanvasRenderingContext2D, height: number) {
    const { in: a, out: b } = this.session.marks.value;
    if (a !== undefined || b !== undefined) {
      const x0 = a !== undefined ? this.x(a) : GUTTER;
      const x1 = b !== undefined ? this.x(b) : this.canvas.clientWidth;
      g.fillStyle = this.color('--accent');
      g.globalAlpha = 0.12;
      g.fillRect(Math.max(GUTTER, x0), RULER, Math.max(0, x1 - Math.max(GUTTER, x0)), height - RULER);
      g.globalAlpha = 1;
      for (const [x, inEdge] of [[a !== undefined ? x0 : null, true], [b !== undefined ? x1 : null, false]] as const) {
        if (x === null || x < GUTTER) continue;
        g.fillRect(x - 1, 0, 2, height);
        g.beginPath();
        g.moveTo(x, RULER - 10);
        g.lineTo(inEdge ? x + 7 : x - 7, RULER - 10);
        g.lineTo(x, RULER);
        g.fill();
      }
    }
    for (const marker of this.project.markers ?? []) {
      const x = this.x(marker.time);
      if (x < GUTTER - 8 || x > this.canvas.clientWidth + 8) continue;
      g.fillStyle = MARKER_PAINT[marker.color] ?? MARKER_PAINT.blue;
      if (marker.duration > 0) g.fillRect(x, RULER - 6, Math.max(2, marker.duration * this.pps), 4);
      g.beginPath();
      g.moveTo(x - 5, 2);
      g.lineTo(x + 5, 2);
      g.lineTo(x + 5, 10);
      g.lineTo(x, 15);
      g.lineTo(x - 5, 10);
      g.fill();
    }
  }

  private paintRuler(g: CanvasRenderingContext2D, width: number) {
    g.font = `12px ${UI_FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const step = STEPS.find((s) => s * this.pps >= 70) ?? 2400;
    const fps = this.project.settings?.fps ?? 25;
    const y = RULER / 2;
    for (let time = Math.max(0, Math.floor(this.time(GUTTER) / step) * step); this.x(time - step) < width; time += step) {
      const x = this.x(time);
      g.fillStyle = this.color('--faint');
      for (let k = 1; k < 5; k++) {
        const dot = x + (k * step * this.pps) / 5;
        if (dot > GUTTER) g.fillRect(dot - 1, y - 1, 2, 2);
      }
      if (x < GUTTER - 20) continue;
      g.fillStyle = this.color('--muted');
      g.fillText(rulerLabel(time, step, fps), x, y);
    }
    g.textAlign = 'start';
  }

  private paintHeader(g: CanvasRenderingContext2D, lane: Lane) {
    g.fillStyle = this.color('--tl-bg');
    g.fillRect(0, lane.top - LANE_GAP / 2, GUTTER, lane.height + LANE_GAP);
    const color = this.color(lane.track.muted ? '--danger' : '--fg');
    const mid = lane.top + lane.height / 2;
    g.save();
    g.translate(GUTTER / 2 - 11, mid - 19);
    g.globalAlpha = lane.track.muted ? 0.7 : 0.85;
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(TRACK_ICONS[lane.track.kind]);
    g.restore();
    g.font = `600 10px ${UI_FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = this.color(lane.track.muted ? '--danger' : '--muted');
    g.fillText(lane.track.muted ? `${lane.label} ×` : lane.label, GUTTER / 2, mid + 15);
    g.textAlign = 'start';
  }

  private paintLane(g: CanvasRenderingContext2D, lane: Lane, width: number) {
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
    const partner = !selected && !!item.link && !!this.selection.id && linkedIds(this.project, this.selection.id).includes(item.id);
    const top = lane.top;
    const h = lane.height;
    const w = Math.max(0, x1 - x0 - 2);
    const audio = lane.track.kind === 'audio';
    g.fillStyle = this.color(item.kind === 'text' ? '--clip-text' : audio ? '--clip-audio' : selected ? '--clip-selected' : '--clip');
    g.beginPath();
    g.roundRect(x0 + 1, top, w, h, RADIUS);
    g.fill();
    g.strokeStyle = this.color('--clip-edge');
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x0 + 1.5, top + 0.5, Math.max(0, w - 1), h - 1, RADIUS);
    g.stroke();
    if (item.kind === 'media' && lane.track.kind === 'video') this.paintThumbnails(g, item, lane, x0, x1);
    if (item.kind === 'media' && !item.videoOnly) this.paintWaveform(g, item, lane, x0, x1);
    if (item.effects.some((e) => e.enabled)) {
      g.fillStyle = this.color('--accent');
      g.beginPath();
      g.roundRect(x0 + 10, top + h - 5, Math.max(0, w - 18), 3, 1.5);
      g.fill();
    }
    if (p.fadeIn > 0) this.paintTransition(g, lane, x0, this.x(p.start + p.fadeIn));
    if (partner) {
      g.strokeStyle = this.color('--accent');
      g.setLineDash([4, 3]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(x0 + 2, top + 1, Math.max(0, x1 - x0 - 4), h - 2, RADIUS);
      g.stroke();
      g.setLineDash([]);
    }
    if (selected) {
      g.strokeStyle = this.color('--accent');
      g.lineWidth = 2.5;
      g.beginPath();
      g.roundRect(x0 + 2, top + 1.25, Math.max(0, x1 - x0 - 4), h - 2.5, RADIUS);
      g.stroke();
      this.paintKeyframes(g, item, lane, p.start);
    }
    g.save();
    g.beginPath();
    g.rect(x0 + 6, top, Math.max(0, x1 - x0 - 12), h);
    g.clip();
    g.textBaseline = 'middle';
    g.font = `500 11.5px ${UI_FONT}`;
    const name = item.kind === 'media' ? (this.project.assets[item.source.assetId]?.name ?? '') : item.text.content.split('\n')[0];
    const label = item.link ? `⛓ ${name}` : name;
    const pill = (text: string, x: number, y: number, tag?: string) => {
      const tagWidth = tag ? g.measureText(tag).width + 12 : 0;
      const width = g.measureText(text).width + 14 + tagWidth;
      g.fillStyle = this.color('--label-backdrop');
      g.beginPath();
      g.roundRect(x, y, width, 18, 9);
      g.fill();
      if (tag) {
        g.fillStyle = this.color('--panel-3');
        g.beginPath();
        g.roundRect(x + 2, y + 2, tagWidth - 2, 14, 7);
        g.fill();
        g.fillStyle = this.color('--muted');
        g.fillText(tag, x + 7, y + 9.5);
      }
      g.fillStyle = this.color('--fg-strong');
      g.fillText(text, x + 7 + tagWidth, y + 9.5);
    };
    pill(label, x0 + 6, top + 5, item.kind === 'text' ? t('addTitle').replace(/^\+\s*/, '') : undefined);
    if (h > 44 && !audio) {
      g.font = `500 10.5px ${UI_FONT}`;
      pill(`${(p.end - p.start).toFixed(2)}s`, x0 + 6, top + h - 23);
    }
    g.restore();
  }

  private paintThumbnails(g: CanvasRenderingContext2D, item: Extract<Item, { kind: 'media' }>, lane: Lane, x0: number, x1: number) {
    const strip = this.session.thumbnails(item.source.assetId);
    const sample = strip?.frames.find((f) => f);
    if (!strip || !sample) return;
    const top = lane.top;
    const h = lane.height;
    const tile = (sample.width / sample.height) * h;
    const from = Math.max(x0 + 1, GUTTER);
    const to = Math.min(x1 - 1, this.canvas.clientWidth);
    if (to <= from || h <= 8) return;
    g.save();
    g.beginPath();
    g.roundRect(x0 + 1, lane.top, Math.max(0, x1 - x0 - 2), lane.height, RADIUS);
    g.clip();
    for (let x = x0 + 1 + Math.max(0, Math.floor((from - x0 - 1) / tile)) * tile; x < to; x += tile) {
      const source = sourceTimeAt(item, (x - x0 + tile / 2) / this.pps);
      const index = Math.min(strip.frames.length - 1, Math.max(0, Math.floor((source - strip.start) / strip.interval)));
      const frame = strip.frames[index];
      if (frame) g.drawImage(frame, x, top, tile, h);
    }
    g.restore();
  }

  private paintWaveform(g: CanvasRenderingContext2D, item: Extract<Item, { kind: 'media' }>, lane: Lane, x0: number, x1: number) {
    const peaks = this.session.peaks(item.source.assetId);
    if (!peaks?.length) return;
    const audio = lane.track.kind === 'audio';
    const band = audio ? lane.height - 12 : 14;
    const mid = audio ? lane.top + lane.height / 2 : lane.top + lane.height - 4 - band / 2;
    g.fillStyle = this.color('--waveform');
    const from = Math.max(x0, GUTTER);
    const to = Math.min(x1, this.canvas.clientWidth);
    const volume = item.volume;
    for (let x = Math.floor(from); x < to; x++) {
      const source = sourceTimeAt(item, (x - x0) / this.pps);
      const span = Math.max(1, Math.round((PEAK_RATE * item.speed) / this.pps));
      const index = Math.floor(source * PEAK_RATE);
      let peak = 0;
      for (let k = 0; k < span; k++) peak = Math.max(peak, peaks[index + k] ?? 0);
      const amp = Math.min(1, Math.sqrt(peak * volume)) * (band / 2);
      if (amp > 0.3 && x % 3 === 0) g.fillRect(x, mid - amp, 2, amp * 2);
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
    const ghost = this.ghost;
    if (!ghost) return;
    const { lane } = ghost;
    g.fillStyle = this.color('--accent');
    if (lane.track.magnetic) {
      const others = placeTrack(lane.track).filter((x) => x.item.id !== ghost.ignore);
      const at = ghost.drop > 0 ? others[ghost.drop - 1].end : 0;
      g.fillRect(this.x(at) - 1.5, lane.top - 3, 3, lane.height + 6);
      return;
    }
    const x0 = this.x(ghost.start);
    const x1 = this.x(ghost.start + itemLength(ghost.item));
    g.globalAlpha = 0.5;
    g.beginPath();
    g.roundRect(x0, lane.top, Math.max(2, x1 - x0), lane.height, RADIUS);
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
