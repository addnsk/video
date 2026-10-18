export const SCOPE_COLUMNS = 256;
export const SCOPE_LEVELS = 256;
export const VECTOR_SIZE = 128;

export interface ScopeData {
  readonly columns: number;
  readonly levels: number;
  readonly waveform: Uint32Array;
  readonly vector: Uint32Array;
  readonly histogram: Uint32Array;
  readonly samples: number;
}

const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

export function analyze(pixels: Uint8Array, width: number, height: number): ScopeData {
  const waveform = new Uint32Array(SCOPE_COLUMNS * SCOPE_LEVELS * 4);
  const vector = new Uint32Array(VECTOR_SIZE * VECTOR_SIZE);
  const histogram = new Uint32Array(256 * 4);
  let samples = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const luma = Math.round(KR * r + KG * g + KB * b);
      const column = Math.floor((x * SCOPE_COLUMNS) / width);
      const base = column * SCOPE_LEVELS * 4;
      waveform[base + r * 4]++;
      waveform[base + g * 4 + 1]++;
      waveform[base + b * 4 + 2]++;
      waveform[base + luma * 4 + 3]++;
      histogram[r * 4]++;
      histogram[g * 4 + 1]++;
      histogram[b * 4 + 2]++;
      histogram[luma * 4 + 3]++;
      const cb = (b - luma) / (2 * (1 - KB)) / 255;
      const cr = (r - luma) / (2 * (1 - KR)) / 255;
      const vx = Math.min(VECTOR_SIZE - 1, Math.max(0, Math.round((cb + 0.5) * (VECTOR_SIZE - 1))));
      const vy = Math.min(VECTOR_SIZE - 1, Math.max(0, Math.round((0.5 - cr) * (VECTOR_SIZE - 1))));
      vector[vy * VECTOR_SIZE + vx]++;
      samples++;
    }
  }
  return { columns: SCOPE_COLUMNS, levels: SCOPE_LEVELS, waveform, vector, histogram, samples };
}
