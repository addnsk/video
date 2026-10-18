import { describe, expect, it } from 'vitest';
import { valueAt } from '../../src/core/animation';
import { insertMaskVertex, removeMaskVertex } from '../../src/core/mask-operations';
import { emptyProject, type Item } from '../../src/core/model';
import { addAsset, insertItem, sequence, setKeyframe, upsertEffect } from '../../src/core/operations';
import { findPlacement } from '../../src/core/timeline';
import { asset } from './fixtures';

const square = [-0.2, -0.2, 0.2, -0.2, 0.2, 0.2, -0.2, 0.2];
const key = (i: number) => `node.m.points.${i}`;

const base = () => {
  let project = sequence(addAsset(asset('a')), insertItem('a', { trackId: 'v1', id: 'x' }))(emptyProject());
  project = {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, effects: [{ id: 'm', type: 'polygon-mask', enabled: true, params: { points: square } }] })) })),
  };
  return project;
};
const item = (p: ReturnType<typeof base>): Item => findPlacement(p, 'x')!.item;
const pointAt = (it: Item, i: number, t: number) => {
  const points = it.effects[0].params.points as number[];
  return [valueAt(it.animations[key(i * 2)], t, points[i * 2]), valueAt(it.animations[key(i * 2 + 1)], t, points[i * 2 + 1])];
};

describe('mask vertices on animated masks', () => {
  it('inserts a vertex into a static mask', () => {
    const p = insertMaskVertex('x', { nodeId: 'm', after: 0, stride: 2, vertex: [0, -0.3], time: 0 })(base());
    expect(item(p).effects[0].params.points).toEqual([-0.2, -0.2, 0, -0.3, 0.2, -0.2, 0.2, 0.2, -0.2, 0.2]);
  });

  it('inserts into every keyframe, keeps the old vertices moving and renumbers their keys', () => {
    let p = sequence(setKeyframe('x', key(4), 0, 0.2), setKeyframe('x', key(4), 2, 0.4), setKeyframe('x', key(0), 2, -0.4))(base());
    const before = item(p);
    p = insertMaskVertex('x', { nodeId: 'm', after: 0, stride: 2, vertex: [0, -0.35], time: 1 })(p);
    const after = item(p);
    for (const t of [0, 0.5, 1.5, 2]) {
      expect(pointAt(after, 0, t)).toEqual(pointAt(before, 0, t));
      expect(pointAt(after, 2, t)).toEqual(pointAt(before, 1, t));
      expect(pointAt(after, 3, t)).toEqual(pointAt(before, 2, t));
    }
    expect(pointAt(after, 1, 1)).toEqual([0, -0.35]);
    expect(pointAt(after, 1, 0)[0]).toBeCloseTo((-0.4 + 0.2) / 2, 9);
    expect(pointAt(after, 1, 2)[0]).toBeCloseTo((-0.4 + 0.2) / 2, 9);
  });

  it('removes a vertex with its keys and keeps at least three', () => {
    let p = sequence(setKeyframe('x', key(6), 0, -0.2), setKeyframe('x', key(6), 1, -0.3), setKeyframe('x', key(2), 1, 0.3))(base());
    p = removeMaskVertex('x', 'm', 1, 2)(p);
    const it = item(p);
    expect(it.effects[0].params.points).toEqual([-0.2, -0.2, 0.2, 0.2, -0.2, 0.2]);
    expect(Object.keys(it.animations).sort()).toEqual([key(4)]);
    expect(pointAt(it, 2, 1)[0]).toBeCloseTo(-0.3, 9);
    expect(item(removeMaskVertex('x', 'm', 0, 2)(removeMaskVertex('x', 'm', 0, 2)(p))).effects[0].params.points).toHaveLength(6);
  });
});
