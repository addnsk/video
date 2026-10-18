import { h } from '../dom';
import { Slider } from './slider';

export type WheelValue = readonly [number, number, number];

const RANGE = 0.25;
const SIZE = 192;

function hueColor(angle: number): string {
  const rgb = [0, 2, 4].map((k) => Math.cos(angle - (k * Math.PI) / 3));
  const [r, g, b] = rgb.map((v) => Math.round(120 + v * 90));
  return `rgb(${r} ${g} ${b})`;
}

export class ColorWheel {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private master: Slider;
  private value: WheelValue = [0, 0, 0];

  constructor(
    id: string,
    label: string,
    private onInput: (value: WheelValue) => void,
  ) {
    this.canvas = h('canvas', { width: SIZE, height: SIZE, 'aria-label': label });
    this.master = new Slider({
      id: `${id}-master`,
      label,
      min: -0.5,
      max: 0.5,
      step: 0.005,
      value: 0,
      neutral: 0,
      onInput: (m) => this.commit([this.value[0], this.value[1], m]),
    });
    this.element = h('div', { class: 'wheel' }, this.canvas, this.master.element);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.canvas.hasPointerCapture(e.pointerId) && this.pointer(e));
    this.canvas.addEventListener('dblclick', () => this.commit([0, 0, this.value[2]]));
    this.paint();
  }

  set(value: WheelValue): void {
    this.value = value;
    this.master.set(value[2]);
    this.paint();
  }

  set disabled(value: boolean) {
    this.master.disabled = value;
    this.element.classList.toggle('disabled', value);
  }

  private pointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(x, y);
    if (len > 1) [x, y] = [x / len, y / len];
    this.commit([x * RANGE, y * RANGE, this.value[2]]);
  }

  private commit(value: WheelValue) {
    this.set(value);
    this.onInput(value);
  }

  private paint() {
    const g = this.canvas.getContext('2d')!;
    const c = SIZE / 2;
    const style = getComputedStyle(this.canvas);
    g.clearRect(0, 0, SIZE, SIZE);
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      g.strokeStyle = hueColor(rad);
      g.lineWidth = 8;
      g.beginPath();
      g.arc(c, c, c - 6, -rad, -rad - 0.04, true);
      g.stroke();
    }
    g.fillStyle = style.getPropertyValue('--wheel-bg') || '#16191d';
    g.beginPath();
    g.arc(c, c, c - 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = style.getPropertyValue('--line') || '#2f343c';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(c, 14);
    g.lineTo(c, SIZE - 14);
    g.moveTo(14, c);
    g.lineTo(SIZE - 14, c);
    g.stroke();
    g.fillStyle = style.getPropertyValue('--accent') || '#e9a23b';
    g.beginPath();
    g.arc(c + (this.value[0] / RANGE) * (c - 14), c + (this.value[1] / RANGE) * (c - 14), 7, 0, Math.PI * 2);
    g.fill();
  }
}
