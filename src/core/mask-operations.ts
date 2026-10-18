import { valueAt } from './animation';
import { nodeProperty } from './graph';
import type { Animations, Keyframe } from './model';
import { updateItem, type Operation } from './operations';

const pointsPrefix = (nodeId: string) => nodeProperty(nodeId, 'points.');

const indexOf = (path: string, prefix: string): number | null => (path.startsWith(prefix) ? Number(path.slice(prefix.length)) : null);

function renumber(animations: Animations, prefix: string, from: number, shift: number, drop: (index: number) => boolean): Record<string, readonly Keyframe[]> {
  const out: Record<string, readonly Keyframe[]> = {};
  for (const [path, keys] of Object.entries(animations)) {
    const index = indexOf(path, prefix);
    if (index === null) out[path] = keys;
    else if (drop(index)) continue;
    else out[index >= from ? `${prefix}${index + shift}` : path] = keys;
  }
  return out;
}

export interface VertexInsert {
  readonly nodeId: string;
  readonly after: number;
  readonly stride: number;
  readonly vertex: readonly number[];
  readonly time: number;
}

export const insertMaskVertex = (itemId: string, insert: VertexInsert): Operation =>
  updateItem(itemId, (item) => {
    const effect = item.effects.find((e) => e.id === insert.nodeId);
    if (!effect) return item;
    const { stride, after, vertex, time } = insert;
    const base = [...((effect.params.points as number[] | undefined) ?? [])];
    const count = Math.floor(base.length / stride);
    const at = (after + 1) * stride;
    const prefix = pointsPrefix(insert.nodeId);
    const animated = Object.keys(item.animations).filter((p) => p.startsWith(prefix));
    const next = (after + 1) % Math.max(1, count);
    const midpoint = (keysFor: (i: number) => readonly Keyframe[] | undefined, t: number, coordinate: number) => {
      const a = valueAt(keysFor(after * stride + coordinate), t, base[after * stride + coordinate] ?? 0);
      const b = valueAt(keysFor(next * stride + coordinate), t, base[next * stride + coordinate] ?? 0);
      return (a + b) / 2;
    };
    const inserted = base.slice();
    inserted.splice(at, 0, ...vertex.map((v, c) => (c < 2 ? midpoint(() => undefined, 0, c) : 0)));
    if (!animated.length) {
      inserted.splice(at, stride, ...vertex);
      return { ...item, effects: item.effects.map((e) => (e === effect ? { ...e, params: { ...e.params, points: inserted } } : e)) };
    }
    const keysFor = (i: number) => item.animations[`${prefix}${i}`];
    const times = [...new Set(animated.flatMap((p) => item.animations[p].map((k) => k.t)))].sort((x, y) => x - y);
    const animations = renumber(item.animations, prefix, at, stride, () => false);
    vertex.forEach((value, c) => {
      const keys: Keyframe[] = times.map((t) => ({ t, v: c < 2 ? midpoint(keysFor, t, c) : 0 }));
      const own = keys.findIndex((k) => Math.abs(k.t - time) < 1e-3);
      if (own >= 0) keys[own] = { t: time, v: value };
      else keys.push({ t: time, v: value });
      animations[`${prefix}${at + c}`] = keys.sort((x, y) => x.t - y.t);
    });
    return { ...item, animations, effects: item.effects.map((e) => (e === effect ? { ...e, params: { ...e.params, points: inserted } } : e)) };
  });

export const removeMaskVertex = (itemId: string, nodeId: string, index: number, stride: number): Operation =>
  updateItem(itemId, (item) => {
    const effect = item.effects.find((e) => e.id === nodeId);
    if (!effect) return item;
    const base = [...((effect.params.points as number[] | undefined) ?? [])];
    if (base.length / stride <= 3) return item;
    base.splice(index * stride, stride);
    const from = index * stride;
    const animations = renumber(item.animations, pointsPrefix(nodeId), from + stride, -stride, (i) => i >= from && i < from + stride);
    return { ...item, animations, effects: item.effects.map((e) => (e === effect ? { ...e, params: { ...e.params, points: base } } : e)) };
  });
