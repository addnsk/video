export function catmullRom(points: readonly number[], closed: boolean, subdivisions: number, max: number): number[] {
  const n = points.length / 2;
  if (n < 3 || subdivisions < 2) return points.slice(0, max * 2);
  const at = (i: number) => {
    const k = closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i));
    return [points[k * 2], points[k * 2 + 1]];
  };
  const steps = Math.max(1, Math.min(subdivisions, Math.floor(max / n)));
  const out: number[] = [];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      for (let c = 0; c < 2; c++)
        out.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
    }
  }
  if (!closed) out.push(...at(n - 1));
  return out.slice(0, max * 2);
}

export const BEZIER_STRIDE = 6;

export function bezierPath(data: readonly number[], closed: boolean, subdivisions: number, max: number): number[] {
  const n = Math.floor(data.length / BEZIER_STRIDE);
  if (n < 2) return [];
  const steps = Math.max(1, Math.min(subdivisions, Math.floor(max / n)));
  const out: number[] = [];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = i * BEZIER_STRIDE;
    const b = ((i + 1) % n) * BEZIER_STRIDE;
    const p0 = [data[a], data[a + 1]];
    const p1 = [data[a] + data[a + 4], data[a + 1] + data[a + 5]];
    const p2 = [data[b] + data[b + 2], data[b + 1] + data[b + 3]];
    const p3 = [data[b], data[b + 1]];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      for (let c = 0; c < 2; c++) out.push(u * u * u * p0[c] + 3 * u * u * t * p1[c] + 3 * u * t * t * p2[c] + t * t * t * p3[c]);
    }
  }
  if (!closed) out.push(data[(n - 1) * BEZIER_STRIDE], data[(n - 1) * BEZIER_STRIDE + 1]);
  return out.slice(0, max * 2);
}
