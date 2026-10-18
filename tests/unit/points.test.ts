import { describe, expect, it } from 'vitest';
import { nodeProperty } from '../../src/core/graph';
import { emptyProject } from '../../src/core/model';
import { addAsset, insertItem, sequence, setKeyframe, upsertEffect } from '../../src/core/operations';
import { resolveItem } from '../../src/core/resolve';
import { catmullRom } from '../../src/effects/points';
import { asset } from './fixtures';

describe('catmullRom', () => {
  it('passes through the control points and subdivides', () => {
    const square = [0, 0, 1, 0, 1, 1, 0, 1];
    const smooth = catmullRom(square, true, 4, 64);
    expect(smooth).toHaveLength(4 * 4 * 2);
    expect(smooth.slice(0, 2)).toEqual([0, 0]);
    expect(smooth.slice(8, 10)).toEqual([1, 0]);
    expect(catmullRom(square, true, 8, 10)).toHaveLength(16);
    expect(catmullRom([0, 0, 1, 1], true, 4, 64)).toEqual([0, 0, 1, 1]);
  });
});

describe('vector parameter keyframes', () => {
  it('animates single components of array params', () => {
    const p = sequence(
      addAsset(asset('a')),
      insertItem('a', { trackId: 'v1', id: 'c' }),
      upsertEffect('c', 'polygon-mask', { points: [0, 0, 1, 0, 1, 1] }),
    )(emptyProject());
    const id = p.tracks[0].items[0].effects[0].id;
    const q = sequence(setKeyframe('c', nodeProperty(id, 'points.2'), 0, 1), setKeyframe('c', nodeProperty(id, 'points.2'), 2, 3))(p);
    const resolved = resolveItem(q.tracks[0].items[0], 1);
    expect(resolved.effects[0].params.points).toEqual([0, 0, 2, 0, 1, 1]);
    expect(q.tracks[0].items[0].effects[0].params.points).toEqual([0, 0, 1, 0, 1, 1]);
  });
});
