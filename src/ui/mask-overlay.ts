import { nodeProperty } from '../core/graph';
import { setNodeParams } from '../core/graph-operations';
import type { Item } from '../core/model';
import { sequence, setKeyframe, type Operation } from '../core/operations';
import { resolveItem } from '../core/resolve';
import { BEZIER_STRIDE, bezierPath } from '../effects/points';
import { findPlacement } from '../core/timeline';
import type { EditorSession } from '../host/session';

const SVG = 'http://www.w3.org/2000/svg';

interface Target {
  readonly itemId: string;
  readonly nodeId: string;
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export class MaskOverlay {
  readonly element: SVGSVGElement;
  private target: Target | null = null;
  private dragging: { index: number; pointerId: number; part: 'anchor' | 'in' | 'out' } | null = null;

  constructor(
    private session: EditorSession,
    private screen: HTMLElement,
  ) {
    this.element = svg('svg', { class: 'mask-overlay', id: 'mask-overlay' });
    this.element.style.display = 'none';
    screen.append(this.element);
    session.store.on('change', () => this.render());
    session.transport.on('time', () => this.render());
    new ResizeObserver(() => this.render()).observe(screen);

  }

  show(target: Target | null): void {
    this.target = target;
    this.render();
  }

  private context(): { item: Item; local: number; points: number[]; animated: boolean; bezier: boolean } | null {
    const target = this.target;
    if (!target) return null;
    const placement = findPlacement(this.session.store.project, target.itemId);
    const effect = placement?.item.effects.find((e) => e.id === target.nodeId);
    if (!placement || !effect || this.session.registry.node(effect.type)?.params.every((p) => p.type !== 'points')) return null;
    const local = Math.min(Math.max(0, this.session.transport.time - placement.start), placement.end - placement.start);
    const resolved = resolveItem(placement.item, local).effects.find((e) => e.id === target.nodeId);
    const spec = this.session.registry.node(effect.type)!.params.find((p) => p.type === 'points')!;
    const points = [...((resolved?.params.points as number[] | undefined) ?? (spec.default as number[]))];
    const animated = Object.keys(placement.item.animations).some((path) => path.startsWith(nodeProperty(target.nodeId, 'points.')));
    return { item: placement.item, local, points, animated, bezier: spec.type === 'points' && !!spec.bezier };
  }

  private frame(): { x: number; y: number; width: number; height: number } {
    const settings = this.session.store.project.settings;
    const width = this.screen.clientWidth;
    const height = this.screen.clientHeight;
    const aspect = settings ? settings.width / settings.height : width / Math.max(1, height);
    const w = width / height > aspect ? height * aspect : width;
    const h = width / height > aspect ? height : width / aspect;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  }

  private toScreen(px: number, py: number) {
    const f = this.frame();
    return [f.x + (px + 0.5) * f.width, f.y + (py + 0.5) * f.height] as const;
  }

  private toFrame(clientX: number, clientY: number) {
    const r = this.screen.getBoundingClientRect();
    const f = this.frame();
    return [(clientX - r.left - f.x) / f.width - 0.5, (clientY - r.top - f.y) / f.height - 0.5] as const;
  }

  private commit(points: number[], changed: readonly number[]) {
    const ctx = this.context();
    const target = this.target;
    if (!ctx || !target) return;
    const ops: Operation[] = ctx.animated
      ? changed.map((i) => setKeyframe(target.itemId, nodeProperty(target.nodeId, `points.${i}`), ctx.local, points[i]))
      : [setNodeParams(target.itemId, target.nodeId, { points })];
    this.session.store.dispatch(sequence(...ops), { coalesce: `mask:${target.nodeId}` });
  }

  private render() {
    const ctx = this.context();
    this.element.style.display = ctx ? '' : 'none';
    if (!ctx) return;
    this.element.replaceChildren();
    const { points, bezier } = ctx;
    const stride = bezier ? BEZIER_STRIDE : 2;
    const n = Math.floor(points.length / stride);
    const anchors = Array.from({ length: n }, (_, i) => this.toScreen(points[i * stride], points[i * stride + 1]));
    const outline = bezier ? bezierPath(points, true, 16, 512) : points;
    const path = Array.from({ length: outline.length / 2 }, (_, i) => this.toScreen(outline[i * 2], outline[i * 2 + 1]));
    this.element.append(svg('polygon', { points: path.map((p) => p.join(',')).join(' '), class: 'mask-path' }));
    anchors.forEach(([x, y], i) => {
      const [nx, ny] = anchors[(i + 1) % n];
      const add = svg('circle', { cx: (x + nx) / 2, cy: (y + ny) / 2, r: 5, class: 'mask-add', 'data-index': i });
      add.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const [fx, fy] = this.toFrame(e.clientX, e.clientY);
        const next = [...points];
        next.splice((i + 1) * stride, 0, ...(bezier ? [fx, fy, 0, 0, 0, 0] : [fx, fy]));
        if (!ctx.animated) this.commit(next, []);
      });
      this.element.append(add);
    });
    const handle = (cx: number, cy: number, index: number, part: 'anchor' | 'in' | 'out') => {
      const el = svg('circle', { cx, cy, r: part === 'anchor' ? 7 : 5, class: part === 'anchor' ? 'mask-point' : 'mask-handle', 'data-index': index, 'data-part': part });
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dragging = { index, pointerId: e.pointerId, part };
        const move = (ev: PointerEvent) => ev.pointerId === e.pointerId && this.move(ev);
        const end = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          this.dragging = null;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      });
      return el;
    };
    anchors.forEach(([x, y], i) => {
      if (bezier) {
        for (const [part, offset] of [['in', 2], ['out', 4]] as const) {
          const [hx, hy] = this.toScreen(points[i * stride] + points[i * stride + offset], points[i * stride + 1] + points[i * stride + offset + 1]);
          this.element.append(svg('line', { x1: x, y1: y, x2: hx, y2: hy, class: 'mask-handle-line' }), handle(hx, hy, i, part));
        }
      }
      const anchor = handle(x, y, i, 'anchor');
      anchor.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (n <= 3 || ctx.animated) return;
        const next = [...points];
        next.splice(i * stride, stride);
        this.commit(next, []);
      });
      this.element.append(anchor);
    });
  }

  private move(e: PointerEvent) {
    const d = this.dragging;
    const ctx = this.context();
    if (!d || !ctx) return;
    const [fx, fy] = this.toFrame(e.clientX, e.clientY);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const stride = ctx.bezier ? BEZIER_STRIDE : 2;
    const base = d.index * stride;
    const next = [...ctx.points];
    if (d.part === 'anchor') {
      next[base] = round(fx);
      next[base + 1] = round(fy);
      this.commit(next, [base, base + 1]);
      return;
    }
    const own = d.part === 'in' ? 2 : 4;
    const other = d.part === 'in' ? 4 : 2;
    next[base + own] = round(fx - next[base]);
    next[base + own + 1] = round(fy - next[base + 1]);
    const changed = [base + own, base + own + 1];
    if (!e.altKey) {
      next[base + other] = -next[base + own];
      next[base + other + 1] = -next[base + own + 1];
      changed.push(base + other, base + other + 1);
    }
    this.commit(next, changed);
  }
}
