import type { Project, Clip } from './project';
import type { Player } from './player';

const RULER = 26;
const TRACK_TOP = RULER + 10;
const TRACK_H = 64;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'pan'; x0: number; scroll0: number }
  | { kind: 'trim'; clip: Clip; edge: 'in' | 'out'; x0: number; orig: number }
  | { kind: 'move'; clip: Clip; x0: number; moved: boolean; drop: number };

export class Timeline {
  pps = 40; // пикселей на секунду
  scrollX = 0;
  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; pps: number } | null = null;
  private colors = getComputedStyle(document.documentElement);

  constructor(
    private canvas: HTMLCanvasElement,
    private project: Project,
    private player: Player,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  private css(name: string) {
    return this.colors.getPropertyValue(name).trim();
  }

  private x(t: number) {
    return t * this.pps - this.scrollX;
  }

  private t(x: number) {
    return (x + this.scrollX) / this.pps;
  }

  zoom(factor: number, anchorX = this.canvas.clientWidth / 2) {
    const t = this.t(anchorX);
    this.pps = Math.min(800, Math.max(2, this.pps * factor));
    this.scrollX = Math.max(0, t * this.pps - anchorX);
    this.draw();
  }

  fit() {
    const d = this.project.duration;
    if (d > 0) this.pps = Math.min(800, Math.max(2, (this.canvas.clientWidth - 40) / d));
    this.scrollX = 0;
    this.draw();
  }

  /** Держит плейхед в кадре во время воспроизведения. */
  follow(t: number) {
    const x = this.x(t);
    const w = this.canvas.clientWidth;
    if (x > w - 40 || x < 0) this.scrollX = Math.max(0, t * this.pps - 40);
  }

  private hit(x: number, y: number): { clip: Clip; edge: 'in' | 'out' | null } | null {
    if (y < TRACK_TOP || y > TRACK_TOP + TRACK_H) return null;
    const grab = matchMedia('(pointer: coarse)').matches ? 16 : 7;
    let start = 0;
    for (const clip of this.project.clips) {
      const x0 = this.x(start);
      const x1 = this.x(start + clip.out - clip.in);
      if (x >= x0 - 2 && x <= x1 + 2) {
        const w = x1 - x0;
        const g = Math.min(grab, w / 3);
        return { clip, edge: x - x0 < g ? 'in' : x1 - x < g ? 'out' : null };
      }
      start += clip.out - clip.in;
    }
    return null;
  }

  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), pps: this.pps };
      this.drag = null;
      return;
    }
    if (p.y < RULER) {
      this.drag = { kind: 'scrub' };
      this.player.seek(this.t(p.x));
      return;
    }
    const hit = this.hit(p.x, p.y);
    if (!hit) {
      this.drag = { kind: 'pan', x0: p.x, scroll0: this.scrollX };
      return;
    }
    this.project.selected = hit.clip.id;
    if (hit.edge) {
      this.drag = { kind: 'trim', clip: hit.clip, edge: hit.edge, x0: p.x, orig: hit.edge === 'in' ? hit.clip.in : hit.clip.out };
    } else {
      this.drag = { kind: 'move', clip: hit.clip, x0: p.x, moved: false, drop: -1 };
    }
    this.project.changed();
  }

  private move(e: PointerEvent) {
    const p = this.pos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = this.pinch.pps * (dist / this.pinch.dist);
      this.zoom(target / this.pps, (a.x + b.x) / 2);
      return;
    }
    const d = this.drag;
    if (!d) {
      const hit = this.hit(p.x, p.y);
      this.canvas.style.cursor = p.y < RULER ? 'col-resize' : hit?.edge ? 'ew-resize' : hit ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'scrub') this.player.seek(this.t(p.x));
    else if (d.kind === 'pan') {
      this.scrollX = Math.max(0, d.scroll0 - (p.x - d.x0));
      this.draw();
    } else if (d.kind === 'trim') {
      const asset = this.project.assets.get(d.clip.assetId)!;
      const dt = (p.x - d.x0) / this.pps;
      const min = 1 / this.project.fps;
      if (d.edge === 'in') d.clip.in = Math.min(Math.max(asset.start, d.orig + dt), d.clip.out - min);
      else d.clip.out = Math.max(Math.min(asset.end, d.orig + dt), d.clip.in + min);
      this.project.changed();
      this.player.seek(d.edge === 'in' ? this.project.startOf(d.clip) : this.project.startOf(d.clip) + d.clip.out - d.clip.in - 1e-3);
    } else if (d.kind === 'move') {
      if (!d.moved && Math.abs(p.x - d.x0) < 6) return;
      d.moved = true;
      const t = this.t(p.x);
      let start = 0;
      let index = 0;
      for (const c of this.project.clips) {
        if (c === d.clip) continue;
        const len = c.out - c.in;
        if (t > start + len / 2) index++;
        start += len;
      }
      d.drop = index;
      this.draw(p.x);
    }
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'move') {
      if (d.moved && d.drop >= 0) this.project.move(d.clip.id, d.drop);
      else this.player.seek(this.t(this.pos(e).x));
    }
    this.draw();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoom(Math.exp(-e.deltaY * 0.01), this.pos(e as unknown as PointerEvent).x);
    } else {
      this.scrollX = Math.max(0, this.scrollX + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
      this.draw();
    }
  }

  private step() {
    const minPx = 70;
    for (const s of [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * this.pps >= minPx) return s;
    return 1200;
  }

  draw(ghostX?: number) {
    const c = this.canvas;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = this.css('--tl-bg');
    g.fillRect(0, 0, w, h);

    // Линейка
    g.fillStyle = this.css('--panel');
    g.fillRect(0, 0, w, RULER);
    g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    const step = this.step();
    const t0 = Math.floor(this.t(0) / step) * step;
    for (let t = t0; this.x(t) < w; t += step) {
      const x = Math.round(this.x(t)) + 0.5;
      g.fillStyle = this.css('--line');
      g.fillRect(x, RULER - 8, 1, 8);
      g.fillStyle = this.css('--muted');
      g.fillText(formatTime(t, step < 1 ? this.project.fps : 0), x + 4, RULER / 2 - 1);
    }

    // Клипы
    let start = 0;
    const selected = this.project.selected;
    for (const clip of this.project.clips) {
      const len = clip.out - clip.in;
      const x0 = this.x(start);
      const x1 = this.x(start + len);
      start += len;
      if (x1 < 0 || x0 > w) continue;
      const asset = this.project.assets.get(clip.assetId)!;
      const isSel = clip.id === selected;
      const dragging = this.drag?.kind === 'move' && this.drag.clip === clip && this.drag.moved;
      g.globalAlpha = dragging ? 0.35 : 1;
      g.fillStyle = isSel ? this.css('--clip-sel') : this.css('--clip');
      roundRect(g, x0 + 1, TRACK_TOP, x1 - x0 - 2, TRACK_H, 4);
      g.fill();
      g.fillStyle = this.css('--clip-band');
      g.fillRect(x0 + 1, TRACK_TOP + TRACK_H - 6, x1 - x0 - 2, 6);
      if (clip.grade.lut || clip.grade.input !== 'none') {
        g.fillStyle = this.css('--accent');
        g.fillRect(x0 + 1, TRACK_TOP + TRACK_H - 6, x1 - x0 - 2, 6);
      }
      if (isSel) {
        g.strokeStyle = this.css('--accent');
        g.lineWidth = 2;
        roundRect(g, x0 + 2, TRACK_TOP + 1, x1 - x0 - 4, TRACK_H - 2, 4);
        g.stroke();
      }
      g.save();
      g.beginPath();
      g.rect(x0 + 6, TRACK_TOP, Math.max(0, x1 - x0 - 12), TRACK_H);
      g.clip();
      g.fillStyle = this.css('--fg');
      g.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
      g.fillText(asset.name, x0 + 8, TRACK_TOP + 16);
      g.fillStyle = this.css('--muted');
      g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText(`${asset.codec} · ${formatTime(len, asset.fps)}`, x0 + 8, TRACK_TOP + 34);
      g.restore();
      g.globalAlpha = 1;
    }

    if (ghostX !== undefined && this.drag?.kind === 'move') {
      let t = 0;
      let i = 0;
      for (const cl of this.project.clips) {
        if (cl === this.drag.clip) continue;
        if (i === this.drag.drop) break;
        t += cl.out - cl.in;
        i++;
      }
      g.fillStyle = this.css('--accent');
      g.fillRect(this.x(t) - 1.5, TRACK_TOP - 4, 3, TRACK_H + 8);
    }

    if (!this.project.clips.length) {
      g.fillStyle = this.css('--muted');
      g.font = '13px "IBM Plex Sans", system-ui, sans-serif';
      g.fillText('Импортируйте видео — клипы встанут сюда по порядку', 16, TRACK_TOP + TRACK_H / 2);
    }

    // Плейхед
    const px = Math.round(this.x(this.player.time)) + 0.5;
    g.fillStyle = this.css('--playhead');
    g.fillRect(px - 0.5, 0, 2, h);
    g.beginPath();
    g.moveTo(px - 6, 0);
    g.lineTo(px + 7, 0);
    g.lineTo(px + 0.5, 9);
    g.fill();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, Math.max(0, w), h, Math.min(r, w / 2));
}

/** Таймкод ЧЧ:ММ:СС:КК, если передана частота кадров, иначе ММ:СС. */
export function formatTime(t: number, fps = 0) {
  const s = Math.max(0, t) + 1e-6;
  const pad = (n: number) => String(n).padStart(2, '0');
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (!fps) return `${pad(m)}:${pad(sec)}`;
  const frames = Math.min(Math.round(fps) - 1, Math.floor((s % 1) * Math.round(fps)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:${pad(sec)}:${pad(frames)}`;
}
