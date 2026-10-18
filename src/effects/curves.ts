export type CurvePoints = readonly number[];

export const IDENTITY_CURVE: CurvePoints = [0, 0, 1, 1];
export const FLAT_CURVE: CurvePoints = [0, 0.5, 1, 0.5];
export const CURVE_RESOLUTION = 256;

export function toPairs(points: CurvePoints): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push([points[i], points[i + 1]]);
  return pairs.sort((a, b) => a[0] - b[0]);
}

export const fromPairs = (pairs: readonly (readonly [number, number])[]): number[] =>
  [...pairs].sort((a, b) => a[0] - b[0]).flatMap(([x, y]) => [x, y]);

export function sampleCurve(points: CurvePoints, resolution = CURVE_RESOLUTION, periodic = false): Float32Array {
  const pairs = toPairs(points);
  const out = new Float32Array(resolution);
  if (pairs.length === 0) return out.map((_, i) => i / (resolution - 1));
  if (pairs.length === 1) return out.fill(pairs[0][1]);
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const n = xs.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) slopes.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const tangents: number[] = [slopes[0]];
  for (let i = 1; i < n - 1; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  tangents.push(slopes[n - 2]);
  if (periodic) tangents[0] = tangents[n - 1] = (slopes[0] + slopes[n - 2]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangents[i] = (3 * a * slopes[i]) / h;
      tangents[i + 1] = (3 * b * slopes[i]) / h;
    }
  }
  for (let k = 0; k < resolution; k++) {
    const x = k / (resolution - 1);
    if (x <= xs[0]) {
      out[k] = ys[0];
      continue;
    }
    if (x >= xs[n - 1]) {
      out[k] = ys[n - 1];
      continue;
    }
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    out[k] =
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * tangents[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * tangents[i + 1];
  }
  return out;
}
