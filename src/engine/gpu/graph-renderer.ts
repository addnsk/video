import { OUTPUT_NODE, SOURCE_NODE, evaluationOrder, inputsOf, nodeById, type NodeGraph } from '../../core/graph';
import type { EffectInstance, ParamValues } from '../../core/model';
import type { FilterDef, NodeDef } from '../../effects/types';

export interface GraphRuntime<T> {
  source(): T | null;
  filter(def: FilterDef, effect: EffectInstance, input: T): T;
  node(def: NodeDef, params: ParamValues, inputs: ReadonlyMap<string, T>): T;
  release(target: T): void;
}

export interface NodeLookup {
  filter(type: string): FilterDef | undefined;
  node(type: string): NodeDef | undefined;
}

export function renderGraph<T>(graph: NodeGraph, outputId: string, lookup: NodeLookup, runtime: GraphRuntime<T>): T | null {
  const order = evaluationOrder(graph, outputId);
  const reachable = new Set(order);
  const uses = new Map<string, number>();
  for (const link of graph.links) if (reachable.has(link.to) && reachable.has(link.from)) uses.set(link.from, (uses.get(link.from) ?? 0) + 1);
  const results = new Map<string, T | null>();
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
      runtime.release(target);
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
    let result: T | null;
    if (node.type === SOURCE_NODE) result = runtime.source();
    else if (node.type === OUTPUT_NODE || !node.enabled) result = primary;
    else {
      const filter = lookup.filter(node.type);
      const def = lookup.node(node.type);
      const effect: EffectInstance = { id: node.id, type: node.type, enabled: true, params: node.params };
      if (filter) result = primary === null ? null : runtime.filter(filter, effect, primary);
      else if (def) result = runtime.node(def, node.params, read);
      else result = primary;
    }
    results.set(id, result);
    hold(result, id === outputId ? 1 : (uses.get(id) ?? 0));
    for (const from of inputs.values()) drop(results.get(from) ?? null);
    if (result !== null && !refs.has(result)) runtime.release(result);
  }
  return results.get(outputId) ?? null;
}
