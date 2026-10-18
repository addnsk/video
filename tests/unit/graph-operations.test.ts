import { describe, expect, it } from 'vitest';
import { evaluationOrder, materialize, type NodeGraph } from '../../src/core/graph';
import {
  addGraphNode,
  connectNodes,
  disableGraph,
  disconnectInput,
  enableGraph,
  moveGraphNode,
  removeGraphNode,
  setNodeEnabled,
  setNodeParams,
} from '../../src/core/graph-operations';
import { emptyProject, type Item, type Project } from '../../src/core/model';
import { addAsset, copyEffects, insertItem, replaceEffect, sequence, splitAt, upsertEffect } from '../../src/core/operations';
import { asset } from './fixtures';

const context = { stageOf: (t: string) => ({ grade: 10, curves: 20 })[t] ?? 50, isVisual: (t: string) => t !== 'eq' };
const item = (p: Project, id = 'c') => p.tracks.flatMap((t) => t.items).find((i) => i.id === id)!;
const graphOf = (i: Item): NodeGraph => materialize(i.effects, i.graph, context.stageOf, context.isVisual);
const order = (i: Item) => evaluationOrder(graphOf(i), 'output').map((id) => i.effects.find((e) => e.id === id)?.type ?? id);

const base = () =>
  sequence(
    addAsset(asset('a', 10)),
    insertItem('a', { trackId: 'v1', id: 'c' }),
    insertItem('a', { trackId: 'v1', id: 'd' }),
    upsertEffect('c', 'curves', { x: 1 }),
    upsertEffect('c', 'grade', { exposure: 1 }),
    upsertEffect('c', 'eq', { low: 3 }),
  )(emptyProject());

describe('graph operations', () => {
  it('turns the effect chain into an editable graph without changing the result', () => {
    const before = order(item(base()));
    const p = enableGraph('c', context)(base());
    expect(item(p).graph).toBeDefined();
    expect(order(item(p))).toEqual(before);
    expect(before).toEqual(['source', 'grade', 'curves', 'output']);
    expect(enableGraph('c', context)(p)).toBe(p);
  });

  it('adds, wires, moves and removes nodes', () => {
    let p = sequence(enableGraph('c', context), addGraphNode('c', 'merge', { mode: 'screen' }, [400, 200], 'm'))(base());
    const grade = item(p).effects.find((e) => e.type === 'grade')!.id;
    p = sequence(
      connectNodes('c', { from: 'source', to: 'm', input: 'background' }),
      connectNodes('c', { from: grade, to: 'm', input: 'foreground' }),
      connectNodes('c', { from: 'm', to: 'output', input: 'input' }),
      moveGraphNode('c', 'm', [500, 250]),
    )(p);
    expect(order(item(p))).toEqual(['source', 'grade', 'merge', 'output']);
    expect(item(p).graph!.positions.m).toEqual([500, 250]);
    expect(() => connectNodes('c', { from: 'm', to: grade, input: 'source' })(p)).toThrow('cycle');
    p = removeGraphNode('c', 'm')(p);
    expect(item(p).effects.some((e) => e.id === 'm')).toBe(false);
    expect(order(item(p))).toEqual(['source', 'output']);
    expect(disconnectInput('c', 'output', 'input')(p).tracks[0].items[0].graph!.links.some((l) => l.to === 'output')).toBe(false);
  });

  it('keeps graphs in sync with effect operations', () => {
    let p = sequence(enableGraph('c', context), upsertEffect('c', 'blur', { radius: 2 }))(base());
    expect(order(item(p))).toEqual(['source', 'grade', 'curves', 'blur', 'output']);
    p = replaceEffect('c', 'curves', null)(p);
    expect(order(item(p))).toEqual(['source', 'grade', 'blur', 'output']);
    p = replaceEffect('c', 'grade', { exposure: 2 })(p);
    expect(order(item(p))).toEqual(['source', 'grade', 'blur', 'output']);
  });

  it('remaps node ids when splitting or copying', () => {
    let p = sequence(enableGraph('c', context), splitAt(5, 'v1', 'r'))(base());
    expect(order(item(p, 'r'))).toEqual(['source', 'grade', 'curves', 'output']);
    expect(item(p, 'r').effects.map((e) => e.id)).not.toEqual(item(p, 'c').effects.map((e) => e.id));
    p = copyEffects('c', ['d'])(p);
    expect(order(item(p, 'd'))).toEqual(['source', 'grade', 'curves', 'output']);
  });

  it('edits node params, enables nodes and drops the graph', () => {
    let p = enableGraph('c', context)(base());
    const id = item(p).effects[0].id;
    p = sequence(setNodeParams('c', id, { y: 2 }), setNodeEnabled('c', id, false))(p);
    expect(item(p).effects[0]).toMatchObject({ params: { x: 1, y: 2 }, enabled: false });
    expect(item(disableGraph('c')(p)).graph).toBeUndefined();
    expect(() => addGraphNode('d', 'blur', {}, [0, 0])(p)).toThrow('no node graph');
  });
});
