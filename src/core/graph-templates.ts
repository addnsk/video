import { addGraphNode, connectNodes } from './graph-operations';
import { OUTPUT_ID, SOURCE_ID, nodeProperty } from './graph';
import { createId } from './ids';
import type { Item, Keyframe, ParamValues } from './model';
import { sequence, updateItem, type Operation } from './operations';

export interface TemplateNode {
  readonly key: string;
  readonly type: string;
  readonly params: ParamValues;
  readonly position: readonly [number, number];
}

export interface TemplateLink {
  readonly from: string;
  readonly to: string;
  readonly input: string;
}

export interface NodeTemplate {
  readonly name: string;
  readonly nodes: readonly TemplateNode[];
  readonly links: readonly TemplateLink[];
  readonly animations: Readonly<Record<string, readonly Keyframe[]>>;
  readonly inputs: readonly { readonly node: string; readonly input: string }[];
  readonly output: string | null;
}

const EXTERNAL = new Set([SOURCE_ID, OUTPUT_ID]);

export function captureTemplate(item: Item, nodeIds: readonly string[], name: string): NodeTemplate {
  const chosen = new Set(nodeIds.filter((id) => !EXTERNAL.has(id) && item.effects.some((e) => e.id === id)));
  if (!chosen.size) throw new Error('No nodes to save');
  const keys = new Map([...chosen].map((id, i) => [id, `n${i}`]));
  const links = item.graph?.links ?? [];
  const positions = item.graph?.positions ?? {};
  const origin = [...chosen].map((id) => positions[id] ?? [0, 0]);
  const minX = Math.min(...origin.map((p) => p[0]));
  const minY = Math.min(...origin.map((p) => p[1]));
  const animations: Record<string, readonly Keyframe[]> = {};
  for (const [path, frames] of Object.entries(item.animations)) {
    const [, id, ...rest] = path.split('.');
    if (path.startsWith('node.') && chosen.has(id)) animations[`${keys.get(id)}.${rest.join('.')}`] = frames;
  }
  const outgoing = links.filter((l) => chosen.has(l.from) && !chosen.has(l.to));
  return {
    name,
    nodes: item.effects
      .filter((e) => chosen.has(e.id))
      .map((e) => {
        const p = positions[e.id] ?? [0, 0];
        return { key: keys.get(e.id)!, type: e.type, params: e.params, position: [p[0] - minX, p[1] - minY] as const };
      }),
    links: links.filter((l) => chosen.has(l.from) && chosen.has(l.to)).map((l) => ({ from: keys.get(l.from)!, to: keys.get(l.to)!, input: l.input })),
    animations,
    inputs: links.filter((l) => !chosen.has(l.from) && chosen.has(l.to)).map((l) => ({ node: keys.get(l.to)!, input: l.input })),
    output: outgoing.length ? keys.get(outgoing[0].from)! : null,
  };
}

export interface PlacedTemplate {
  readonly ids: Readonly<Record<string, string>>;
  readonly operation: Operation;
}

export function placeTemplate(itemId: string, template: NodeTemplate, at: readonly [number, number], source?: string): PlacedTemplate {
  const ids = Object.fromEntries(template.nodes.map((n) => [n.key, createId('fx')]));
  const ops: Operation[] = template.nodes.map((n) => addGraphNode(itemId, n.type, n.params, [n.position[0] + at[0], n.position[1] + at[1]], ids[n.key]));
  for (const l of template.links) ops.push(connectNodes(itemId, { from: ids[l.from], to: ids[l.to], input: l.input }));
  if (source) for (const i of template.inputs) ops.push(connectNodes(itemId, { from: source, to: ids[i.node], input: i.input }));
  ops.push(
    updateItem(itemId, (item: Item) => {
      const animations = { ...item.animations };
      for (const [path, frames] of Object.entries(template.animations)) {
        const [key, ...rest] = path.split('.');
        if (ids[key]) animations[nodeProperty(ids[key], rest.join('.'))] = frames;
      }
      return { ...item, animations };
    }),
  );
  return { ids, operation: sequence(...ops) };
}
