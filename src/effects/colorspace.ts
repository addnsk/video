export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
export type Chromaticity = readonly [number, number];

export interface Primaries {
  readonly r: Chromaticity;
  readonly g: Chromaticity;
  readonly b: Chromaticity;
  readonly white: Chromaticity;
}

const D65: Chromaticity = [0.3127, 0.329];

export const REC709: Primaries = { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: D65 };

export const BMD_WIDE_GAMUT_GEN5: Primaries = {
  r: [0.7177, 0.3171],
  g: [0.228, 0.8616],
  b: [0.1006, -0.082],
  white: D65,
};

const xyz = ([x, y]: Chromaticity): [number, number, number] => [x / y, 1, (1 - x - y) / y];

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return out as unknown as Mat3;
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function rgbToXyz(p: Primaries): Mat3 {
  const [rx, ry, rz] = xyz(p.r);
  const [gx, gy, gz] = xyz(p.g);
  const [bx, by, bz] = xyz(p.b);
  const m: Mat3 = [rx, gx, bx, ry, gy, by, rz, gz, bz];
  const [wx, wy, wz] = xyz(p.white);
  const inv = invert(m);
  const s = [inv[0] * wx + inv[1] * wy + inv[2] * wz, inv[3] * wx + inv[4] * wy + inv[5] * wz, inv[6] * wx + inv[7] * wy + inv[8] * wz];
  return [m[0] * s[0], m[1] * s[1], m[2] * s[2], m[3] * s[0], m[4] * s[1], m[5] * s[2], m[6] * s[0], m[7] * s[1], m[8] * s[2]];
}

export const gamutMatrix = (from: Primaries, to: Primaries): Mat3 => multiply(invert(rgbToXyz(to)), rgbToXyz(from));

export function glslMat3(m: Mat3): string {
  const f = (v: number) => v.toFixed(8);
  return `mat3(${f(m[0])}, ${f(m[3])}, ${f(m[6])}, ${f(m[1])}, ${f(m[4])}, ${f(m[7])}, ${f(m[2])}, ${f(m[5])}, ${f(m[8])})`;
}
