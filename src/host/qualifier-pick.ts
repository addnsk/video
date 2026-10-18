import { setNodeParams } from '../core/graph-operations';
import { findPlacement } from '../core/timeline';
import { QUALIFIER_TYPES, qualifierFromColor } from '../effects/qualifier-pick';
import type { ParamValues } from '../core/model';
import type { EditorSession } from './session';

const SPREAD = 0.004;

export async function pickQualifier(session: EditorSession, itemId: string, nodeId: string, point: { x: number; y: number }, options: { add?: boolean; time?: number } = {}): Promise<ParamValues> {
  const { store } = session;
  const placement = findPlacement(store.project, itemId);
  const node = placement?.item.effects.find((e) => e.id === nodeId);
  if (!placement || !node) throw new Error('No such node');
  if (!(QUALIFIER_TYPES as readonly string[]).includes(node.type)) throw new Error(`Node "${node.type}" is not a qualifier`);
  const around = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: point.x + dx * SPREAD, y: point.y + dy * SPREAD })));
  const samples = await session.engine.remote.sampleNodeInput(options.time ?? session.transport.time, itemId, nodeId, around);
  if (!samples?.length) throw new Error('Nothing to pick at this time');
  const rgb = [0, 1, 2].map((c) => samples.reduce((sum, s) => sum + s[c], 0) / samples.length);
  const def = session.registry.node(node.type);
  const defaults = Object.fromEntries((def?.params ?? []).map((p) => [p.name, p.default as ParamValues[string]]));
  const params = qualifierFromColor(node.type, rgb, { ...defaults, ...node.params }, options.add);
  store.dispatch(setNodeParams(itemId, nodeId, params));
  return params;
}
