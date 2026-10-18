import { PROPERTY, effectProperty, valueAt } from './animation';
import type { EffectInstance, Item, ParamValues, Transform } from './model';
import { nodeProperty } from './graph';
import { effectiveAnimations } from './presets';

export interface ResolvedItem {
  readonly opacity: number;
  readonly volume: number;
  readonly transform: Transform;
  readonly effects: readonly EffectInstance[];
}

export function resolveItem(item: Item, local: number): ResolvedItem {
  const a = effectiveAnimations(item);
  if (!Object.keys(a).length) return item;
  const effects = item.effects.map((e) => {
    let params: ParamValues | null = null;
    const prefixes = [`${nodeProperty(e.id, '')}`, `${effectProperty(e.type, '')}`];
    const animated = Object.keys(a).flatMap((path) => prefixes.filter((p) => path.startsWith(p)).map((p) => path.slice(p.length)));
    for (const name of new Set([...Object.keys(e.params), ...animated])) {
      const keys = a[nodeProperty(e.id, name)] ?? a[effectProperty(e.type, name)];
      if (!keys) continue;
      params ??= { ...e.params };
      (params as Record<string, unknown>)[name] = valueAt(keys, local, Number(e.params[name] ?? 0));
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
