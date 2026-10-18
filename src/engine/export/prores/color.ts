import type { Planes422 } from './encoder';

const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

export interface RgbaSource {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly bottomUp?: boolean;
  readonly overBlack?: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function toPlanes422(source: RgbaSource, target?: Planes422): Planes422 {
  const { data, width, height, scale } = source;
  const chromaWidth = width >> 1;
  const planes =
    target && target.width === width && target.height === height
      ? target
      : { width, height, y: new Uint16Array(width * height), cb: new Uint16Array(chromaWidth * height), cr: new Uint16Array(chromaWidth * height) };
  for (let row = 0; row < height; row++) {
    const sourceRow = source.bottomUp ? height - 1 - row : row;
    for (let x = 0; x < chromaWidth; x++) {
      let pb = 0;
      let pr = 0;
      for (let k = 0; k < 2; k++) {
        const i = (sourceRow * width + x * 2 + k) * 4;
        const alpha = source.overBlack ? clamp01(data[i + 3] * scale) : 1;
        const r = clamp01(data[i] * scale) * alpha;
        const g = clamp01(data[i + 1] * scale) * alpha;
        const b = clamp01(data[i + 2] * scale) * alpha;
        const luma = KR * r + KG * g + KB * b;
        planes.y[row * width + x * 2 + k] = Math.round(64 + 876 * luma);
        pb += (b - luma) / (2 * (1 - KB));
        pr += (r - luma) / (2 * (1 - KR));
      }
      planes.cb[row * chromaWidth + x] = Math.round(512 + 896 * (pb / 2));
      planes.cr[row * chromaWidth + x] = Math.round(512 + 896 * (pr / 2));
    }
  }
  return planes;
}

export const rgbaToPlanes422 = (rgba: ArrayLike<number>, width: number, height: number, target?: Planes422): Planes422 =>
  toPlanes422({ data: rgba, width, height, scale: 1 / 255 }, target);
