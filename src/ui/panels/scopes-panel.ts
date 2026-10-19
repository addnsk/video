import type { ScopeData } from '../../engine/scopes';
import { VECTOR_SIZE } from '../../engine/scopes';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { h } from '../dom';

type ScopeMode = 'waveform' | 'parade' | 'vector' | 'histogram';

const MODES: { mode: ScopeMode; label: 'scopeWaveform' | 'scopeParade' | 'scopeVector' | 'scopeHistogram' }[] = [
  { mode: 'waveform', label: 'scopeWaveform' },
  { mode: 'parade', label: 'scopeParade' },
  { mode: 'vector', label: 'scopeVector' },
  { mode: 'histogram', label: 'scopeHistogram' },
];

const CHANNEL_RGB: [number, number, number][] = [
  [255, 90, 80],
  [90, 220, 110],
  [90, 140, 255],
  [220, 220, 220],
];

const VECTOR_TARGETS: [string, number, number, number][] = [
  ['R', 1, 0, 0],
  ['Yl', 1, 1, 0],
  ['G', 0, 1, 0],
  ['Cy', 0, 1, 1],
  ['B', 0, 0, 1],
  ['Mg', 1, 0, 1],
];

export class ScopesPanel {
  readonly element: HTMLDetailsElement;
  private views: { mode: ScopeMode; canvas: HTMLCanvasElement; card: HTMLElement }[];
  private focus: ScopeMode | null = null;
  private last: ScopeData | null = null;

  constructor(private session: EditorSession) {
    this.views = MODES.map(({ mode, label }) => {
      const canvas = h('canvas', { width: 512, height: mode === 'vector' ? 512 : 256, class: `scope scope-${mode}`, id: `scope-${mode}` });
      const card = h('button', {
        type: 'button',
        class: 'scope-card',
        dataset: { scope: mode },
        title: t(label),
        onClick: () => {
          this.focus = this.focus === mode ? null : mode;
          this.layout();
        },
      }, canvas, h('span', { class: 'scope-label' }, t(label)));
      return { mode, canvas, card };
    });
    const grid = h('div', { class: 'scope-grid' }, ...this.views.map((v) => v.card));
    this.element = h('details', { class: 'panel scopes', id: 'scopes' }, h('summary', {}, h('h2', {}, t('scopesTitle'))), grid);
    this.element.addEventListener('toggle', () => void session.engine.remote.setScopes(this.element.open));
    session.engine.events.on('scopes', (data) => {
      this.last = data;
      if (this.element.open) this.draw();
    });
    this.layout();
  }

  get mode(): ScopeMode | null {
    return this.focus;
  }

  private layout() {
    for (const view of this.views) {
      view.card.hidden = !!this.focus && view.mode !== this.focus;
      view.card.setAttribute('aria-pressed', String(view.mode === this.focus));
    }
    this.element.classList.toggle('focused', !!this.focus);
    this.draw();
  }

  private draw() {
    const data = this.last;
    for (const { mode, canvas, card } of this.views) {
      if (card.hidden) continue;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#08090b';
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (!data) continue;
      if (mode === 'vector') this.vector(g, canvas, data);
      else if (mode === 'histogram') this.histogram(g, canvas, data);
      else this.waveform(g, canvas, data, mode === 'parade');
      if (mode !== 'vector') this.graticule(g, canvas, mode !== 'histogram');
    }
  }

  private waveform(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: ScopeData, parade: boolean) {
    const { width, height } = canvas;
    const image = g.createImageData(width, height);
    const channels = parade ? [0, 1, 2] : [3];
    const gain = (256 * 6) / Math.max(1, data.samples / data.columns);
    channels.forEach((channel, slot) => {
      const span = width / channels.length;
      const [cr, cg, cb] = CHANNEL_RGB[channel];
      for (let column = 0; column < data.columns; column++) {
        const x0 = Math.floor(slot * span + (column * span) / data.columns);
        const x1 = Math.max(x0 + 1, Math.floor(slot * span + ((column + 1) * span) / data.columns));
        for (let level = 0; level < data.levels; level++) {
          const count = data.waveform[(column * data.levels + level) * 4 + channel];
          if (!count) continue;
          const intensity = Math.min(1, (count * gain) / 256);
          const y = height - 1 - Math.floor((level * (height - 1)) / 255);
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            image.data[i] = Math.min(255, image.data[i] + cr * intensity);
            image.data[i + 1] = Math.min(255, image.data[i + 1] + cg * intensity);
            image.data[i + 2] = Math.min(255, image.data[i + 2] + cb * intensity);
            image.data[i + 3] = 255;
          }
        }
      }
    });
    g.putImageData(image, 0, 0);
  }

  private histogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: ScopeData) {
    const { width, height } = canvas;
    let peak = 1;
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) peak = Math.max(peak, data.histogram[i * 4 + c]);
    g.globalCompositeOperation = 'lighter';
    for (let c = 0; c < 3; c++) {
      const [r, gg, b] = CHANNEL_RGB[c];
      g.fillStyle = `rgb(${r} ${gg} ${b} / 0.55)`;
      g.beginPath();
      g.moveTo(0, height);
      for (let i = 0; i < 256; i++) g.lineTo((i / 255) * width, height - (Math.sqrt(data.histogram[i * 4 + c] / peak) * height));
      g.lineTo(width, height);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  private vector(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: ScopeData) {
    const { width, height } = canvas;
    const size = height;
    const ox = (width - size) / 2;
    const image = g.createImageData(VECTOR_SIZE, VECTOR_SIZE);
    const gain = (VECTOR_SIZE * VECTOR_SIZE * 4) / Math.max(1, data.samples);
    for (let i = 0; i < data.vector.length; i++) {
      const v = Math.min(255, Math.sqrt(data.vector[i] * gain) * 140);
      image.data[i * 4] = v * 0.7;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v * 0.7;
      image.data[i * 4 + 3] = 255;
    }
    const bitmapCanvas = new OffscreenCanvas(VECTOR_SIZE, VECTOR_SIZE);
    bitmapCanvas.getContext('2d')!.putImageData(image, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(bitmapCanvas, ox, 0, size, size);
    g.strokeStyle = 'rgb(255 255 255 / 0.25)';
    g.beginPath();
    g.arc(ox + size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    g.stroke();
    g.font = '20px "Inter", system-ui, sans-serif';
    g.fillStyle = 'rgb(255 255 255 / 0.6)';
    for (const [label, r, gg, b] of VECTOR_TARGETS) {
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const cb = (b - y) / 1.8556;
      const cr = (r - y) / 1.5748;
      const x = ox + (cb + 0.5) * size;
      const yy = (0.5 - cr) * size;
      g.strokeRect(x - 5, yy - 5, 10, 10);
      g.fillText(label, x + 7, yy + 4);
    }
  }

  private graticule(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, labels: boolean) {
    const { width, height } = canvas;
    g.strokeStyle = 'rgb(255 255 255 / 0.12)';
    g.fillStyle = 'rgb(255 255 255 / 0.4)';
    g.font = '16px "Inter", system-ui, sans-serif';
    for (const level of [0, 25, 50, 75, 100]) {
      const y = Math.round(height - 1 - (level / 100) * (height - 1)) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(width, y);
      g.stroke();
      if (labels) g.fillText(String(level), 4, Math.max(10, y - 2));
    }
  }
}
