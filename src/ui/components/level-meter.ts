import { h } from '../dom';

export interface LevelSource {
  levels(): number[];
  readonly playing: boolean;
}

const FLOOR_DB = -60;
const HOLD_MS = 1200;
const FALL_DB_PER_FRAME = 1.2;

const toDb = (v: number) => (v > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(v)) : FLOOR_DB);

export class LevelMeter {
  readonly element: HTMLCanvasElement;
  private display: number[] = [FLOOR_DB, FLOOR_DB];
  private hold: { db: number; at: number }[] = [
    { db: FLOOR_DB, at: 0 },
    { db: FLOOR_DB, at: 0 },
  ];
  private running = false;
  private style = getComputedStyle(document.documentElement);

  constructor(private source: LevelSource, label: string) {
    this.element = h('canvas', { class: 'meter', id: 'meter', role: 'img', 'aria-label': label, width: 120, height: 18 });
    this.paint();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      this.update();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    this.display = [FLOOR_DB, FLOOR_DB];
    for (const hold of this.hold) hold.db = FLOOR_DB;
    this.paint();
  }

  get peaks(): number[] {
    return this.hold.map((h) => h.db);
  }

  private update() {
    const now = performance.now();
    this.source.levels().forEach((level, i) => {
      const db = toDb(level);
      this.display[i] = Math.max(db, this.display[i] - FALL_DB_PER_FRAME);
      if (db >= this.hold[i].db || now - this.hold[i].at > HOLD_MS) this.hold[i] = { db, at: now };
    });
    this.paint();
  }

  private color(name: string) {
    return this.style.getPropertyValue(name).trim();
  }

  private paint() {
    const canvas = this.element;
    const ratio = devicePixelRatio || 1;
    const width = canvas.clientWidth || 120;
    const height = canvas.clientHeight || 18;
    if (canvas.width !== Math.round(width * ratio)) [canvas.width, canvas.height] = [Math.round(width * ratio), Math.round(height * ratio)];
    const g = canvas.getContext('2d')!;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    const bar = (height - 3) / 2;
    const x = (db: number) => ((db - FLOOR_DB) / -FLOOR_DB) * width;
    const gradient = g.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, this.color('--meter-low'));
    gradient.addColorStop(x(-12) / width, this.color('--meter-low'));
    gradient.addColorStop(x(-6) / width, this.color('--meter-mid'));
    gradient.addColorStop(x(-1) / width, this.color('--meter-high'));
    this.display.forEach((db, i) => {
      const y = i * (bar + 3);
      g.fillStyle = this.color('--lane');
      g.fillRect(0, y, width, bar);
      g.fillStyle = gradient;
      g.fillRect(0, y, x(db), bar);
      if (this.hold[i].db > FLOOR_DB) {
        g.fillStyle = this.color('--fg');
        g.fillRect(Math.min(width - 2, x(this.hold[i].db)), y, 2, bar);
      }
    });
  }
}
