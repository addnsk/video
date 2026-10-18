import type { Animations, EffectInstance, Item, Keyframe, ParamValues, Transform } from './model';

export const PROPERTY = {
  opacity: 'opacity',
  volume: 'volume',
  x: 'transform.x',
  y: 'transform.y',
  scale: 'transform.scale',
  rotation: 'transform.rotation',
} as const;

export const effectProperty = (effectType: string, param: string): string => `fx.${effectType}.${param}`;

const KEY_EPSILON = 1e-3;

export function valueAt(keys: readonly Keyframe[] | undefined, t: number, base: number): number {
  if (!keys?.length) return base;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const f = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

export function upsertKey(keys: readonly Keyframe[] = [], t: number, v: number): Keyframe[] {
  const out = keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);
  out.push({ t, v });
  return out.sort((a, b) => a.t - b.t);
}

export const removeKey = (keys: readonly Keyframe[] = [], t: number): Keyframe[] =>
  keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);

export const keyAt = (keys: readonly Keyframe[] | undefined, t: number): Keyframe | undefined =>
  keys?.find((k) => Math.abs(k.t - t) <= KEY_EPSILON);

export function shiftAnimations(animations: Animations, offset: number, length: number): Animations {
  const out: Record<string, Keyframe[]> = {};
  for (const [path, keys] of Object.entries(animations)) {
    const shifted = keys.map((k) => ({ t: k.t - offset, v: k.v })).filter((k) => k.t >= -KEY_EPSILON && k.t <= length + KEY_EPSILON);
    if (shifted.length) out[path] = shifted;
  }
  return out;
}

export interface ResolvedItem {
  readonly opacity: number;
  readonly volume: number;
  readonly transform: Transform;
  readonly effects: readonly EffectInstance[];
}

export function resolveItem(item: Item, local: number): ResolvedItem {
  const a = item.animations;
  if (!Object.keys(a).length) return item;
  const effects = item.effects.map((e) => {
    let params: ParamValues | null = null;
    for (const name of Object.keys(e.params)) {
      const keys = a[effectProperty(e.type, name)];
      if (!keys) continue;
      params ??= { ...e.params };
      (params as Record<string, unknown>)[name] = valueAt(keys, local, Number(e.params[name]));
    }
    return params ? { ...e, params } : e;
  });
  return {
    opacity: valueAt(a[PROPERTY.opacity], local, item.opacity),
    volume: valueAt(a[PROPERTY.volume], local, item.volume),
    transform: {
      x: valueAt(a[PROPERTY.x], local, item.transform.x),
      y: valueAt(a[PROPERTY.y], local, item.transform.y),
      scale: valueAt(a[PROPERTY.scale], local, item.transform.scale),
      rotation: valueAt(a[PROPERTY.rotation], local, item.transform.rotation),
    },
    effects,
  };
}
