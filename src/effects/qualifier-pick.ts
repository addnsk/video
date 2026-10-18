import type { ParamValues } from '../core/model';

const LUMA = [0.2126, 0.7152, 0.0722];
const SAT_RANGE = 0.15;
const LUM_RANGE = 0.15;
const HUE_WIDTH = 0.05;

export function hsvOf([r, g, b]: readonly number[]): [number, number, number] {
  const [cr, cg, cb] = [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const hi = Math.max(cr, cg, cb);
  const d = hi - Math.min(cr, cg, cb);
  let h = 0;
  if (d > 1e-5) h = (hi === cr ? (((cg - cb) / d) % 6 + 6) % 6 : hi === cg ? (cb - cr) / d + 2 : (cr - cg) / d + 4) / 6;
  return [h, hi > 1e-5 ? d / hi : 0, hi];
}

export const QUALIFIER_TYPES = ['qualifier', 'qualifier-3d'] as const;

export function qualifierFromColor(type: string, rgb: readonly number[], current: ParamValues, add = false): ParamValues {
  if (type === 'qualifier-3d') {
    const keys = ['key1', 'key2', 'key3'];
    const empty = keys.find((k) => !Array.isArray(current[k]) || (current[k] as number[])[3] <= 0);
    const slot = add ? (empty ?? 'key3') : 'key1';
    const cleared: ParamValues = add ? {} : { key2: [0, 0, 0, 0], key3: [0, 0, 0, 0] };
    return { ...cleared, [slot]: [rgb[0], rgb[1], rgb[2], 1] };
  }
  const [h, s] = hsvOf(rgb);
  const lum = LUMA.reduce((sum, k, i) => sum + k * rgb[i], 0);
  return {
    useHue: true,
    hueCenter: h,
    hueWidth: Math.max(HUE_WIDTH, Number(current.hueWidth ?? HUE_WIDTH)),
    useSat: true,
    satLow: Math.max(0, s - SAT_RANGE),
    satHigh: Math.min(1, s + SAT_RANGE),
    useLum: true,
    lumLow: Math.max(0, lum - LUM_RANGE),
    lumHigh: lum + LUM_RANGE,
  };
}
