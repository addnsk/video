import { OUTPUT_NODE, SOURCE_NODE, evaluationOrder, inputsOf, nodeById, type NodeGraph } from '../../core/graph';
import type { EffectInstance, ParamValues } from '../../core/model';
import type { FilterDef, NodeDef } from '../../effects/types';

export interface GraphRuntime<T> {
  source(): T | null;
  filter(def: FilterDef, effect: EffectInstance, input: T): T;
  node(def: NodeDef, params: ParamValues, inputs: ReadonlyMap<string, T>, nodeId: string): T;
  release(target: T): void;
  copy(target: T): T;
}

export interface GraphCache<T> {
  get(key: string): T | undefined;
  put(key: string, target: T): void;
}

export interface NodeLookup {
  filter(type: string): FilterDef | undefined;
  node(type: string): NodeDef | undefined;
}

const timeDependent = new WeakMap<object, boolean>();

function usesTime(def: { passes: readonly { glsl: string }[] } | undefined): boolean {
  if (!def) return false;
  let known = timeDependent.get(def);
  if (known === undefined) timeDependent.set(def, (known = def.passes.some((p) => /\btime\s*\(/.test(p.glsl))));
  return known;
}

export function renderGraph<T>(graph: NodeGraph, outputId: string, lookup: NodeLookup, runtime: GraphRuntime<T>, cache?: GraphCache<T>): T | null {
  const order = evaluationOrder(graph, outputId);
  const reachable = new Set(order);
  const uses = new Map<string, number>();
  for (const link of graph.links) if (reachable.has(link.to) && reachable.has(link.from)) uses.set(link.from, (uses.get(link.from) ?? 0) + 1);
  const results = new Map<string, T | null>();
  const keys = new Map<string, string | null>();
  const borrowed = new Set<T>();
  const refs = new Map<T, number>();
  const hold = (target: T | null, count: number) => {
    if (target !== null && count > 0) refs.set(target, (refs.get(target) ?? 0) + count);
  };
  const drop = (target: T | null) => {
    if (target === null) return;
    const left = (refs.get(target) ?? 0) - 1;
    if (left > 0) refs.set(target, left);
    else {
      refs.delete(target);
      if (!borrowed.has(target)) runtime.release(target);
    }
  };

  for (const id of order) {
    const node = nodeById(graph, id)!;
    const inputs = inputsOf(graph, id);
    const read = new Map<string, T>();
    for (const [name, from] of inputs) {
      const value = results.get(from) ?? null;
      if (value !== null) read.set(name, value);
    }
    const primary = read.get('source') ?? read.get('input') ?? read.values().next().value ?? null;
    const inputKeys = [...inputs].map(([name, from]) => [name, keys.get(from)] as const);
    const key =
      node.type === SOURCE_NODE || lookup.node(node.type)?.temporal || lookup.node(node.type)?.history || usesTime(lookup.node(node.type)) || inputKeys.some(([, k]) => k === null)
        ? null
        : `${node.type}:${node.enabled}:${JSON.stringify(node.params)}(${inputKeys.map(([n, k]) => `${n}=${k}`).join(',')})`;
    keys.set(id, key);
    const passThrough = node.type === OUTPUT_NODE || !node.enabled;
    let result: T | null;
    const hit = key !== null && !passThrough && cache ? cache.get(key) : undefined;
    if (hit !== undefined) {
      result = hit;
      borrowed.add(hit);
    } else if (node.type === SOURCE_NODE) result = runtime.source();
    else if (passThrough) result = primary;
    else {
      const filter = lookup.filter(node.type);
      const def = lookup.node(node.type);
      const effect: EffectInstance = { id: node.id, type: node.type, enabled: true, params: node.params };
      if (filter) result = primary === null ? null : runtime.filter(filter, effect, primary);
      else if (def) result = runtime.node(def, node.params, read, node.id);
      else result = primary;
      if (key !== null && cache && result !== null && result !== primary) {
        cache.put(key, result);
        borrowed.add(result);
      }
    }
    results.set(id, result);
    hold(result, id === outputId ? 1 : (uses.get(id) ?? 0));
    for (const from of inputs.values()) drop(results.get(from) ?? null);
    if (result !== null && !refs.has(result) && !borrowed.has(result)) runtime.release(result);
  }
  const output = results.get(outputId) ?? null;
  return output !== null && borrowed.has(output) ? runtime.copy(output) : output;
}
