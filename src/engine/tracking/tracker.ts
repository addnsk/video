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

export function matchTemplate(frame: LumaFrame, template: Template, cx: number, cy: number, search: number): TrackResult {
  const half = Math.floor(template.size / 2);
  let best = { x: cx, y: cy, confidence: -1 };
  const scores = new Map<string, number>();
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const x0 = Math.round(cx) + dx - half;
      const y0 = Math.round(cy) + dy - half;
      if (x0 < 0 || y0 < 0 || x0 + template.size > frame.width || y0 + template.size > frame.height) continue;
      const s = score(frame, template, x0, y0);
      scores.set(`${dx},${dy}`, s);
      if (s > best.confidence) best = { x: Math.round(cx) + dx, y: Math.round(cy) + dy, confidence: s };
    }
  }
  const at = (dx: number, dy: number) => scores.get(`${best.x - Math.round(cx) + dx},${best.y - Math.round(cy) + dy}`);
  const refine = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined) return 0;
    const d = a - 2 * best.confidence + b;
    return Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (a - b) / (2 * d))) : 0;
  };
  return { x: best.x + refine(at(-1, 0), at(1, 0)), y: best.y + refine(at(0, -1), at(0, 1)), confidence: best.confidence };
}

export class PointTracker {
  private template: Template | null = null;
  private x: number;
  private y: number;

  constructor(
    private options: TrackOptions,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
  }

  step(frame: LumaFrame): TrackResult {
    if (!this.template) {
      this.template = extractTemplate(frame, this.x, this.y, this.options.patch);
      return { x: this.x, y: this.y, confidence: this.template ? 1 : 0 };
    }
    const result = matchTemplate(frame, this.template, this.x, this.y, this.options.search);
    if (result.confidence > 0.5) {
      this.x = result.x;
      this.y = result.y;
      if (result.confidence < 0.85) this.template = extractTemplate(frame, this.x, this.y, this.options.patch) ?? this.template;
    }
    return { x: this.x, y: this.y, confidence: result.confidence };
  }
}
