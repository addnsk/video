import type { ColorTags, Planes422 } from './encoder';

export type DynamicRange = 'sdr' | 'hlg' | 'pq';

export interface ColorEncoding {
  readonly tags: ColorTags;
  readonly kr: number;
  readonly kb: number;
  readonly convert: (rgb: [number, number, number]) => void;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toLinear = (v: number) => (v <= 0 ? 0 : v ** 2.4);

const REC709_TO_REC2020 = [
  0.627404, 0.329283, 0.043313,
  0.069097, 0.91954, 0.011362,
  0.016391, 0.088013, 0.895595,
];

function toRec2020Linear(rgb: [number, number, number], scale: number) {
  const [r, g, b] = [toLinear(rgb[0]) * scale, toLinear(rgb[1]) * scale, toLinear(rgb[2]) * scale];
  const m = REC709_TO_REC2020;
  rgb[0] = Math.max(0, m[0] * r + m[1] * g + m[2] * b);
  rgb[1] = Math.max(0, m[3] * r + m[4] * g + m[5] * b);
  rgb[2] = Math.max(0, m[6] * r + m[7] * g + m[8] * b);
}

const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);
const HLG_REFERENCE_WHITE = 0.2627;
export const hlg = (e: number): number => (e <= 1 / 12 ? Math.sqrt(3 * e) : HLG_A * Math.log(12 * e - HLG_B) + HLG_C);

const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 };
const PQ_REFERENCE_WHITE_NITS = 203;
export const pq = (nits: number): number => {
  const y = Math.min(1, Math.max(0, nits / 10000)) ** PQ.m1;
  return ((PQ.c1 + PQ.c2 * y) / (1 + PQ.c3 * y)) ** PQ.m2;
};

export const ENCODINGS: Readonly<Record<DynamicRange, ColorEncoding>> = {
  sdr: {
    tags: { primaries: 1, transfer: 1, matrix: 1 },
    kr: 0.2126,
    kb: 0.0722,
    convert: (rgb) => {
      rgb[0] = clamp01(rgb[0]);
      rgb[1] = clamp01(rgb[1]);
      rgb[2] = clamp01(rgb[2]);
    },
  },
  hlg: {
    tags: { primaries: 9, transfer: 18, matrix: 9 },
    kr: 0.2627,
    kb: 0.0593,
    convert: (rgb) => {
      toRec2020Linear(rgb, HLG_REFERENCE_WHITE);
      rgb[0] = clamp01(hlg(Math.min(1, rgb[0])));
      rgb[1] = clamp01(hlg(Math.min(1, rgb[1])));
      rgb[2] = clamp01(hlg(Math.min(1, rgb[2])));
    },
  },
  pq: {
    tags: { primaries: 9, transfer: 16, matrix: 9 },
    kr: 0.2627,
    kb: 0.0593,
    convert: (rgb) => {
      toRec2020Linear(rgb, PQ_REFERENCE_WHITE_NITS);
      rgb[0] = pq(rgb[0]);
      rgb[1] = pq(rgb[1]);
      rgb[2] = pq(rgb[2]);
    },
  },
};

export interface RgbaSource {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly bottomUp?: boolean;
  readonly overBlack?: boolean;
}

export function toPlanes422(source: RgbaSource, target?: Planes422, encoding: ColorEncoding = ENCODINGS.sdr): Planes422 {
  const { data, width, height, scale } = source;
  const { kr, kb } = encoding;
  const kg = 1 - kr - kb;
  const chromaWidth = width >> 1;
  const planes =
    target && target.width === width && target.height === height
      ? target
      : { width, height, y: new Uint16Array(width * height), cb: new Uint16Array(chromaWidth * height), cr: new Uint16Array(chromaWidth * height) };
  const rgb: [number, number, number] = [0, 0, 0];
  for (let row = 0; row < height; row++) {
    const sourceRow = source.bottomUp ? height - 1 - row : row;
    for (let x = 0; x < chromaWidth; x++) {
      let pb = 0;
      let pr = 0;
      for (let k = 0; k < 2; k++) {
        const i = (sourceRow * width + x * 2 + k) * 4;
        const alpha = source.overBlack ? clamp01(data[i + 3] * scale) : 1;
        rgb[0] = data[i] * scale * alpha;
        rgb[1] = data[i + 1] * scale * alpha;
        rgb[2] = data[i + 2] * scale * alpha;
        encoding.convert(rgb);
        const luma = kr * rgb[0] + kg * rgb[1] + kb * rgb[2];
        planes.y[row * width + x * 2 + k] = Math.round(64 + 876 * luma);
        pb += (rgb[2] - luma) / (2 * (1 - kb));
        pr += (rgb[0] - luma) / (2 * (1 - kr));
      }
      planes.cb[row * chromaWidth + x] = Math.round(512 + 896 * (pb / 2));
      planes.cr[row * chromaWidth + x] = Math.round(512 + 896 * (pr / 2));
    }
  }
  return planes;
}

export const rgbaToPlanes422 = (rgba: ArrayLike<number>, width: number, height: number, target?: Planes422): Planes422 =>
  toPlanes422({ data: rgba, width, height, scale: 1 / 255 }, target);
