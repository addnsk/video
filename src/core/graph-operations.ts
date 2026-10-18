import {
  GraphError,
  OUTPUT_ID,
  connect,
  graphWithoutNode,
  materialize,
  toItemGraph,
  type GraphLink,
} from './graph';
import { createId } from './ids';
import type { EffectInstance, Item, ParamValues } from './model';
import { updateItem, type Operation } from './operations';

export interface GraphContext {
  stageOf(type: string): number;
  isVisual(type: string): boolean;
}

const everything = () => true;

export const enableGraph = (itemId: string, context: GraphContext): Operation =>
  updateItem(itemId, (item) => {
    if (item.graph) return item;
    return { ...item, graph: toItemGraph(materialize(item.effects, undefined, context.stageOf, context.isVisual)) };
  });

export const disableGraph = (itemId: string): Operation =>
  updateItem(itemId, (item) => {
    if (!item.graph) return item;
    const { graph: _graph, ...rest } = item;
    return rest;
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
    const next = connect(materialize(item.effects, graph, () => 0, everything), link);
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
    return { ...item, effects: item.effects.filter((e) => e.id !== nodeId), graph: graphWithoutNode(graph, nodeId) };
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
