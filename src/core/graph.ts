import type { EffectInstance, Item, ItemGraph, ParamValues } from './model';

export const SOURCE_NODE = 'media.source';
export const OUTPUT_NODE = 'graph.output';

export interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly params: ParamValues;
  readonly enabled: boolean;
  readonly position: readonly [number, number];
}

export interface GraphLink {
  readonly from: string;
  readonly to: string;
  readonly input: string;
}

export interface NodeGraph {
  readonly nodes: readonly GraphNode[];
  readonly links: readonly GraphLink[];
}

export interface NodeSignature {
  readonly inputs: readonly string[];
}

export type SignatureLookup = (type: string) => NodeSignature | undefined;

export class GraphError extends Error {}

const SOURCE_SIGNATURE: NodeSignature = { inputs: [] };
const OUTPUT_SIGNATURE: NodeSignature = { inputs: ['input'] };

export const signatureOf = (type: string, lookup: SignatureLookup): NodeSignature | undefined =>
  type === SOURCE_NODE ? SOURCE_SIGNATURE : type === OUTPUT_NODE ? OUTPUT_SIGNATURE : lookup(type);

export const nodeById = (graph: NodeGraph, id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id);

export const outputNode = (graph: NodeGraph): GraphNode | undefined => graph.nodes.find((n) => n.type === OUTPUT_NODE);

export const inputsOf = (graph: NodeGraph, nodeId: string): ReadonlyMap<string, string> =>
  new Map(graph.links.filter((l) => l.to === nodeId).map((l) => [l.input, l.from]));

export function upstream(graph: NodeGraph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const link of graph.links) {
      if (link.to !== id || seen.has(link.from)) continue;
      seen.add(link.from);
      visit(link.from);
    }
  };
  visit(nodeId);
  return seen;
}

export function evaluationOrder(graph: NodeGraph, target: string): string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') throw new GraphError(`Cycle through node ${id}`);
    state.set(id, 'visiting');
    for (const from of inputsOf(graph, id).values()) visit(from);
    state.set(id, 'done');
    order.push(id);
  };
  visit(target);
  return order;
}

export function validateGraph(graph: NodeGraph, lookup: SignatureLookup): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) problems.push(`Duplicate node id ${node.id}`);
    ids.add(node.id);
    if (!signatureOf(node.type, lookup)) problems.push(`Unknown node type ${node.type}`);
  }
  if (graph.nodes.filter((n) => n.type === OUTPUT_NODE).length !== 1) problems.push('A graph needs exactly one output node');
  const taken = new Set<string>();
  for (const link of graph.links) {
    const to = nodeById(graph, link.to);
    if (!nodeById(graph, link.from) || !to) {
      problems.push(`Link ${link.from} → ${link.to} references a missing node`);
      continue;
    }
    if (!signatureOf(to.type, lookup)?.inputs.includes(link.input)) problems.push(`Node ${to.id} has no input ${link.input}`);
    const key = `${link.to}:${link.input}`;
    if (taken.has(key)) problems.push(`Input ${key} has several links`);
    taken.add(key);
  }
  const output = outputNode(graph);
  if (output) {
    try {
      evaluationOrder(graph, output.id);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return problems;
}

const SPACING = 180;

export function chainGraph(effects: readonly EffectInstance[], stageOf: (type: string) => number): NodeGraph {
  const ordered = effects.slice().sort((a, b) => stageOf(a.type) - stageOf(b.type));
  const nodes: GraphNode[] = [
    { id: 'source', type: SOURCE_NODE, params: {}, enabled: true, position: [0, 0] },
    ...ordered.map((e, i): GraphNode => ({ id: e.id, type: e.type, params: e.params, enabled: e.enabled, position: [(i + 1) * SPACING, 0] })),
    { id: 'output', type: OUTPUT_NODE, params: {}, enabled: true, position: [(ordered.length + 1) * SPACING, 0] },
  ];
  const links = nodes.slice(1).map((node, i): GraphLink => ({ from: nodes[i].id, to: node.id, input: node.type === OUTPUT_NODE ? 'input' : 'source' }));
  return { nodes, links };
}

export function connect(graph: NodeGraph, link: GraphLink): NodeGraph {
  if (link.from === link.to || upstream(graph, link.from).has(link.to)) throw new GraphError('This link would create a cycle');
  const links = graph.links.filter((l) => !(l.to === link.to && l.input === link.input));
  return { ...graph, links: [...links, link] };
}

export const disconnect = (graph: NodeGraph, to: string, input: string): NodeGraph => ({
  ...graph,
  links: graph.links.filter((l) => !(l.to === to && l.input === input)),
});

export function addNode(graph: NodeGraph, node: GraphNode): NodeGraph {
  if (nodeById(graph, node.id)) throw new GraphError(`Node ${node.id} already exists`);
  return { ...graph, nodes: [...graph.nodes, node] };
}

export function removeNode(graph: NodeGraph, id: string, primaryInput?: string): NodeGraph {
  const node = nodeById(graph, id);
  if (!node || node.type === OUTPUT_NODE) return graph;
  const feed = primaryInput ? graph.links.find((l) => l.to === id && l.input === primaryInput)?.from : undefined;
  const links = graph.links
    .filter((l) => l.to !== id)
    .flatMap((l): GraphLink[] => (l.from !== id ? [l] : feed ? [{ ...l, from: feed }] : []));
  return { nodes: graph.nodes.filter((n) => n.id !== id), links };
}

export function insertAfter(graph: NodeGraph, afterId: string, node: GraphNode, input: string): NodeGraph {
  const outgoing = graph.links.filter((l) => l.from === afterId);
  const links = graph.links.filter((l) => l.from !== afterId);
  return {
    nodes: [...graph.nodes, node],
    links: [...links, { from: afterId, to: node.id, input }, ...outgoing.map((l) => ({ ...l, from: node.id }))],
  };
}

export const updateNode = (graph: NodeGraph, id: string, patch: Partial<Omit<GraphNode, 'id' | 'type'>>): NodeGraph => ({
  ...graph,
  nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch, params: patch.params ? { ...n.params, ...patch.params } : n.params } : n)),
});

export const nodeProperty = (nodeId: string, param: string): string => `node.${nodeId}.${param}`;

export const SOURCE_ID = 'source';
export const OUTPUT_ID = 'output';

export function materialize(effects: readonly EffectInstance[], graph: ItemGraph | undefined, stageOf: (type: string) => number, isVisual: (type: string) => boolean): NodeGraph {
  const visual = effects.filter((e) => isVisual(e.type));
  if (!graph) return chainGraph(visual.filter((e) => e.enabled), stageOf);
  const at = (id: string, fallback: readonly [number, number]) => graph.positions[id] ?? fallback;
  const nodes: GraphNode[] = [
    { id: SOURCE_ID, type: SOURCE_NODE, params: {}, enabled: true, position: at(SOURCE_ID, [0, 0]) },
    ...visual.map((e, i): GraphNode => ({ id: e.id, type: e.type, params: e.params, enabled: e.enabled, position: at(e.id, [(i + 1) * SPACING, 120]) })),
    { id: OUTPUT_ID, type: OUTPUT_NODE, params: {}, enabled: true, position: at(OUTPUT_ID, [(visual.length + 1) * SPACING, 0]) },
  ];
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, links: graph.links.filter((l) => ids.has(l.from) && ids.has(l.to)) };
}

export const toItemGraph = (graph: NodeGraph): ItemGraph => ({
  links: graph.links,
  positions: Object.fromEntries(graph.nodes.map((n) => [n.id, n.position])),
});

export const hasGraph = (item: Item): boolean => !!item.graph;

export function graphWithNode(graph: ItemGraph, id: string, input = 'source'): ItemGraph {
  const feed = graph.links.find((l) => l.to === OUTPUT_ID);
  const links = graph.links.filter((l) => l !== feed);
  return {
    ...graph,
    links: [...links, ...(feed ? [{ from: feed.from, to: id, input }] : []), { from: id, to: OUTPUT_ID, input: 'input' }],
  };
}

export function graphWithoutNode(graph: ItemGraph, id: string): ItemGraph {
  const incoming = graph.links.filter((l) => l.to === id);
  const feed = (incoming.find((l) => l.input === 'source') ?? incoming[0])?.from;
  const links = graph.links
    .filter((l) => l.to !== id)
    .flatMap((l) => (l.from !== id ? [l] : feed ? [{ ...l, from: feed }] : []));
  const { [id]: _removed, ...positions } = graph.positions;
  return { links, positions };
}

export function remapGraph(graph: ItemGraph, ids: ReadonlyMap<string, string>): ItemGraph {
  const map = (id: string) => ids.get(id) ?? id;
  return {
    links: graph.links.map((l) => ({ ...l, from: map(l.from), to: map(l.to) })),
    positions: Object.fromEntries(Object.entries(graph.positions).map(([id, p]) => [map(id), p])),
  };
}
