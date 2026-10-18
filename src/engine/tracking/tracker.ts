export interface LumaFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface TrackOptions {
  readonly patch: number;
  readonly search: number;
}

export interface TrackResult {
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
}

export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): LumaFrame {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  return { width, height, data };
}

export interface Template {
  readonly size: number;
  readonly values: Float32Array;
  readonly mean: number;
  readonly norm: number;
}

export function extractTemplate(frame: LumaFrame, cx: number, cy: number, size: number): Template | null {
  const half = Math.floor(size / 2);
  const x0 = Math.round(cx) - half;
  const y0 = Math.round(cy) - half;
  if (x0 < 0 || y0 < 0 || x0 + size > frame.width || y0 + size > frame.height) return null;
  const values = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += values[y * size + x] = frame.data[(y0 + y) * frame.width + x0 + x];
  const mean = sum / values.length;
  let norm = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    norm += values[i] * values[i];
  }
  return { size, values, mean, norm: Math.sqrt(norm) };
}

function score(frame: LumaFrame, template: Template, x0: number, y0: number): number {
  const { size, values } = template;
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += frame.data[(y0 + y) * frame.width + x0 + x];
  const mean = sum / (size * size);
  let cross = 0;
  let norm = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = frame.data[(y0 + y) * frame.width + x0 + x] - mean;
      cross += v * values[y * size + x];
      norm += v * v;
    }
  const denominator = Math.sqrt(norm) * template.norm;
  return denominator > 1e-6 ? cross / denominator : 0;
}

export interface Scorer {
  scores(frame: LumaFrame, template: Template, left: number, top: number, span: number): Float32Array;
}

export const OUTSIDE = -2;

export const scriptScorer: Scorer = {
  scores(frame, template, left, top, span) {
    const out = new Float32Array(span * span);
    for (let j = 0; j < span; j++) {
      for (let i = 0; i < span; i++) {
        const x0 = left + i;
        const y0 = top + j;
        const outside = x0 < 0 || y0 < 0 || x0 + template.size > frame.width || y0 + template.size > frame.height;
        out[j * span + i] = outside ? OUTSIDE : score(frame, template, x0, y0);
      }
    }
    return out;
  },
};

export function matchTemplate(frame: LumaFrame, template: Template, cx: number, cy: number, search: number, scorer: Scorer = scriptScorer): TrackResult {
  const half = Math.floor(template.size / 2);
  const span = search * 2 + 1;
  const rx = Math.round(cx);
  const ry = Math.round(cy);
  const grid = scorer.scores(frame, template, rx - search - half, ry - search - half, span);
  let best = -1;
  let confidence = -1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== OUTSIDE && grid[i] > confidence) {
      confidence = grid[i];
      best = i;
    }
  }
  if (best < 0) return { x: cx, y: cy, confidence: -1 };
  const bi = best % span;
  const bj = Math.floor(best / span);
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= span || j >= span || grid[j * span + i] === OUTSIDE ? undefined : grid[j * span + i]);
  const refine = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined) return 0;
    const d = a - 2 * confidence + b;
    return Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (a - b) / (2 * d))) : 0;
  };
  return {
    x: rx - search + bi + refine(at(bi - 1, bj), at(bi + 1, bj)),
    y: ry - search + bj + refine(at(bi, bj - 1), at(bi, bj + 1)),
    confidence,
  };
}

export class PointTracker {
  private template: Template | null = null;
  private x: number;
  private y: number;

  constructor(
    private options: TrackOptions,
    x: number,
    y: number,
    private scorer: Scorer = scriptScorer,
  ) {
    this.x = x;
    this.y = y;
  }

  step(frame: LumaFrame): TrackResult {
    if (!this.template) {
      this.template = extractTemplate(frame, this.x, this.y, this.options.patch);
      return { x: this.x, y: this.y, confidence: this.template ? 1 : 0 };
    }
    const result = matchTemplate(frame, this.template, this.x, this.y, this.options.search, this.scorer);
    if (result.confidence > 0.5) {
      this.x = result.x;
      this.y = result.y;
      if (result.confidence < 0.85) this.template = extractTemplate(frame, this.x, this.y, this.options.patch) ?? this.template;
    }
    return { x: this.x, y: this.y, confidence: result.confidence };
  }
}
