import { sampleCurve, toPairs, fromPairs, type CurvePoints } from '../../effects/curves';
import { h } from '../dom';

const SIZE = 256;
const HIT = 0.05;
const MAX_POINTS = 16;

export interface CurveChannel {
  readonly name: string;
  readonly label: string;
  readonly color: string;
  readonly periodic?: boolean;
  readonly neutral: CurvePoints;
}

export class CurveEditor {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tabs: HTMLButtonElement[];
  private active: CurveChannel;
  private values = new Map<string, CurvePoints>();
  private dragging: number | null = null;
  private disabledState = false;

  constructor(
    private channels: readonly CurveChannel[],
    private onInput: (name: string, points: CurvePoints) => void,
  ) {
    this.active = channels[0];
    this.canvas = h('canvas', { width: SIZE * 2, height: SIZE * 2, class: 'curve', 'aria-label': 'Curve editor' });
    this.tabs = channels.map((c) =>
      h('button', { class: 'tab', 'aria-pressed': String(c === this.active), onClick: () => this.select(c) }, c.label),
    );
    this.element = h('div', { class: 'curves' }, h('div', { class: 'tabs' }, ...this.tabs), this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = null));
    this.canvas.addEventListener('dblclick', (e) => this.toggle(e));
    this.paint();
  }

  set(values: Record<string, CurvePoints>): void {
    for (const c of this.channels) this.values.set(c.name, values[c.name] ?? c.neutral);
    this.paint();
  }

  set disabled(value: boolean) {
    this.disabledState = value;
    this.element.classList.toggle('disabled', value);
  }

  resetActive(): void {
    this.commit(this.active.neutral);
  }

  private get points(): [number, number][] {
    return toPairs(this.values.get(this.active.name) ?? this.active.neutral);
  }

  private select(channel: CurveChannel) {
    this.active = channel;
    this.tabs.forEach((t, i) => t.setAttribute('aria-pressed', String(this.channels[i] === channel)));
    this.paint();
  }

  private local(e: PointerEvent | MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  }

  private nearest(x: number, y: number): number {
    const points = this.points;
    let best = -1;
    let distance = HIT;
    points.forEach(([px, py], i) => {
      const d = Math.hypot(px - x, py - y);
      if (d < distance) [best, distance] = [i, d];
    });
    return best;
  }

  private down(e: PointerEvent) {
    if (this.disabledState) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e);
    let index = this.nearest(x, y);
    if (index < 0 && this.points.length < MAX_POINTS) {
      const next = [...this.points, [x, y] as [number, number]];
      this.commit(fromPairs(next));
      index = this.points.findIndex(([px, py]) => px === x && py === y);
    }
    this.dragging = index;
  }

  private move(e: PointerEvent) {
    if (this.dragging === null || this.dragging < 0) return;
    const [x, y] = this.local(e);
    const points = this.points;
    const i = this.dragging;
    const isEnd = i === 0 || i === points.length - 1;
    const lo = i > 0 ? points[i - 1][0] + 0.01 : 0;
    const hi = i < points.length - 1 ? points[i + 1][0] - 0.01 : 1;
    points[i] = [isEnd && !this.active.periodic ? points[i][0] : Math.min(hi, Math.max(lo, x)), y];
    this.commit(fromPairs(points));
  }

  private toggle(e: MouseEvent) {
    if (this.disabledState) return;
    const [x, y] = this.local(e);
    const points = this.points;
    const index = this.nearest(x, y);
    if (index > 0 && index < points.length - 1) {
      points.splice(index, 1);
      this.commit(fromPairs(points));
    } else if (index < 0) this.resetActive();
  }

  private commit(points: CurvePoints) {
    this.values.set(this.active.name, points);
    this.paint();
    this.onInput(this.active.name, points);
  }

  private paint() {
    const g = this.canvas.getContext('2d')!;
    const s = this.canvas.width;
    const style = getComputedStyle(this.canvas);
    g.clearRect(0, 0, s, s);
    g.strokeStyle = style.getPropertyValue('--line');
    g.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const p = Math.round((k * s) / 4) + 0.5;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, s);
      g.moveTo(0, p);
      g.lineTo(s, p);
      g.stroke();
    }
    g.setLineDash([4, 4]);
    g.beginPath();
    if (this.active.periodic) {
      g.moveTo(0, s / 2);
      g.lineTo(s, s / 2);
    } else {
      g.moveTo(0, s);
      g.lineTo(s, 0);
    }
    g.stroke();
    g.setLineDash([]);
    const values = this.values.get(this.active.name) ?? this.active.neutral;
    const samples = sampleCurve(values, s / 2, this.active.periodic);
    g.strokeStyle = this.active.color || style.getPropertyValue('--fg');
    g.lineWidth = 3;
    g.beginPath();
    samples.forEach((v, i) => {
      const x = (i / (samples.length - 1)) * s;
      const y = (1 - Math.min(1, Math.max(0, v))) * s;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
    g.fillStyle = style.getPropertyValue('--accent');
    for (const [x, y] of toPairs(values)) {
      g.beginPath();
      g.arc(x * s, (1 - y) * s, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
}
