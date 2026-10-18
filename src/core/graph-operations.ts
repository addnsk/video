import {
  GraphError,
  OUTPUT_ID,
  SOURCE_ID,
  connect,
  graphWithNode,
  graphWithoutNode,
  materialize,
  toItemGraph,
  type GraphLink,
  type GraphTypes,
} from './graph';
import { createId } from './ids';
import type { EffectInstance, Item, ParamValues } from './model';
import { updateItem, type Operation } from './operations';

export type GraphContext = GraphTypes;

const everything: GraphTypes = { stageOf: () => 0, isVisual: () => true, chainable: () => true };

export const enableGraph = (itemId: string, context: GraphContext): Operation =>
  updateItem(itemId, (item) => {
    if (item.graph) return item;
    const { parkedGraph, ...rest } = item;
    if (!parkedGraph) return { ...rest, graph: toItemGraph(materialize(item.effects, undefined, context)) };
    const present = new Set([SOURCE_ID, OUTPUT_ID, ...item.effects.map((e) => e.id)]);
    const stale = [...new Set([...Object.keys(parkedGraph.positions), ...parkedGraph.links.flatMap((l) => [l.from, l.to])])].filter((id) => !present.has(id));
    const pruned = stale.reduce((graph, id) => graphWithoutNode(graph, id), parkedGraph);
    const known = new Set([...Object.keys(pruned.positions), ...pruned.links.flatMap((l) => [l.from, l.to])]);
    const restored = item.effects
      .filter((e) => context.isVisual(e.type) && context.chainable(e.type) && e.enabled && !known.has(e.id))
      .reduce((graph, e) => graphWithNode(graph, e.id), pruned);
    return { ...rest, graph: restored };
  });

export const disableGraph = (itemId: string): Operation =>
  updateItem(itemId, (item) => {
    if (!item.graph) return item;
    const { graph, ...rest } = item;
    return { ...rest, parkedGraph: graph };
  });

const requireGraph = (item: Item) => {
  if (!item.graph) throw new GraphError(`Clip ${item.id} has no node graph`);
  return item.graph;
};

export const addGraphNode = (itemId: string, type: string, params: ParamValues, position: readonly [number, number], id = createId('fx')): Operation =>
  updateItem(itemId, (item) => {
    const graph = requireGraph(item);
    const effect: EffectInstance = { id, type, enabled: true, params };
    return { ...item, effects: [...item.effects, effect], graph: { ...graph, positions: { ...graph.positions, [id]: position } } };
  });

export const connectNodes = (itemId: string, link: GraphLink): Operation =>
  updateItem(itemId, (item) => {
    const graph = requireGraph(item);
    const next = connect(materialize(item.effects, graph, everything), link);
    return { ...item, graph: { ...graph, links: next.links } };
  });

export const disconnectInput = (itemId: string, to: string, input: string): Operation =>
  updateItem(itemId, (item) => {
    const graph = requireGraph(item);
    const links = graph.links.filter((l) => !(l.to === to && l.input === input));
    return links.length === graph.links.length ? item : { ...item, graph: { ...graph, links } };
  });

export const removeGraphNode = (itemId: string, nodeId: string): Operation =>
  updateItem(itemId, (item) => {
    const graph = requireGraph(item);
    if (nodeId === OUTPUT_ID || !item.effects.some((e) => e.id === nodeId)) return item;
    const prefix = `node.${nodeId}.`;
    const animations = Object.fromEntries(Object.entries(item.animations).filter(([path]) => !path.startsWith(prefix)));
    return { ...item, effects: item.effects.filter((e) => e.id !== nodeId), graph: graphWithoutNode(graph, nodeId), animations };
  });

export const moveGraphNode = (itemId: string, nodeId: string, position: readonly [number, number]): Operation =>
  updateItem(itemId, (item) => {
    const graph = requireGraph(item);
    return { ...item, graph: { ...graph, positions: { ...graph.positions, [nodeId]: position } } };
  });

export const setNodeParams = (itemId: string, nodeId: string, params: ParamValues): Operation =>
  updateItem(itemId, (item) => ({
    ...item,
    effects: item.effects.map((e) => (e.id === nodeId ? { ...e, params: { ...e.params, ...params } } : e)),
  }));

export const setNodeEnabled = (itemId: string, nodeId: string, enabled: boolean): Operation =>
  updateItem(itemId, (item) => ({ ...item, effects: item.effects.map((e) => (e.id === nodeId ? { ...e, enabled } : e)) }));
