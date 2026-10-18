import { describe, expect, it } from 'vitest';
import {
  addMarker,
  deleteItems,
  extractRange,
  insertEdit,
  liftRange,
  linkItems,
  openGap,
  overwriteEdit,
  removeMarker,
  rippleTrim,
  rollEdit,
  slideEdit,
  slipEdit,
  updateMarker,
} from '../../src/core/editing';
import { emptyProject, type MediaItem, type Project } from '../../src/core/model';
import { addAsset, createMediaItem, insertItem, insertText, placeItem, sequence, setTransition } from '../../src/core/operations';
import { placeTrack } from '../../src/core/timeline';
import { asset } from './fixtures';

const base = () =>
  sequence(
    addAsset(asset('a', 20)),
    addAsset(asset('b', 20)),
    insertItem('a', { trackId: 'v1', in: 2, out: 6, id: 'one' }),
    insertItem('a', { trackId: 'v1', in: 10, out: 14, id: 'two' }),
    insertItem('a', { trackId: 'a1', in: 2, out: 6, id: 'one-a', start: 0 }),
    insertItem('a', { trackId: 'a1', in: 10, out: 14, id: 'two-a', start: 4 }),
    linkItems(['one', 'one-a'], 'L1'),
    linkItems(['two', 'two-a'], 'L2'),
  )(emptyProject());

const layout = (p: Project, trackId: string) =>
  placeTrack(p.tracks.find((t) => t.id === trackId)!).map((x) => {
    const i = x.item as MediaItem;
    return [i.id.startsWith('item_') ? '*' : i.id, +x.start.toFixed(4), +x.end.toFixed(4), i.source ? +i.source.in.toFixed(4) : 0];
  });
const clip = (p: Project, assetId: string, from: number, to: number, id: string) => createMediaItem(p.assets[assetId], { in: from, out: to, id });

describe('insert and overwrite', () => {
  it('insert splits the clip under the playhead and ripples every track', () => {
    const p = base();
    const next = insertEdit([{ trackId: 'v1', item: clip(p, 'b', 0, 2, 'new') }], 1)(p);
    expect(layout(next, 'v1')).toEqual([['one', 0, 1, 2], ['new', 1, 3, 0], ['*', 3, 6, 3], ['two', 6, 10, 10]]);
    expect(layout(next, 'a1')).toEqual([['one-a', 0, 1, 2], ['*', 3, 6, 3], ['two-a', 6, 10, 10]]);
  });

  it('insert on one track leaves other tracks when scoped to the track', () => {
    const p = base();
    const next = insertEdit([{ trackId: 'v1', item: clip(p, 'b', 0, 2, 'new') }], 4, 'track')(p);
    expect(layout(next, 'v1').map((r) => r[0])).toEqual(['one', 'new', 'two']);
    expect(layout(next, 'a1')).toEqual(layout(p, 'a1'));
  });

  it('overwrite replaces the range without changing the length', () => {
    const p = base();
    const next = overwriteEdit([{ trackId: 'v1', item: clip(p, 'b', 5, 8, 'new') }, { trackId: 'a1', item: clip(p, 'b', 5, 8, 'new-a') }], 2)(p);
    expect(layout(next, 'v1')).toEqual([['one', 0, 2, 2], ['new', 2, 5, 5], ['*', 5, 8, 11]]);
    expect(layout(next, 'a1')).toEqual([['one-a', 0, 2, 2], ['new-a', 2, 5, 5], ['*', 5, 8, 11]]);
  });

  it('overwrite past the end of the main track leaves a gap', () => {
    const p = base();
    const next = overwriteEdit([{ trackId: 'v1', item: clip(p, 'b', 0, 1, 'late') }], 12)(p);
    expect(layout(next, 'v1').at(-1)).toEqual(['late', 12, 13, 0]);
    expect(next.tracks[0].items.at(-1)!.gap).toBeCloseTo(4);
  });

  it('cuts a transition when the edit lands inside it', () => {
    const p = setTransition('two', { type: 'crossfade', duration: 1, params: {} })(base());
    expect(layout(p, 'v1')[1][1]).toBe(3);
    const next = overwriteEdit([{ trackId: 'v1', item: clip(p, 'b', 0, 1, 'x') }], 3.5)(p);
    const ids = layout(next, 'v1').map((r) => r[0]);
    expect(ids).toEqual(['one', 'x', '*']);
    expect(layout(next, 'v1')[0]).toEqual(['one', 0, 3.5, 2]);
  });
});

describe('lift, extract and ripple delete', () => {
  it('lift leaves a gap on the main track; extract closes it', () => {
    const p = base();
    const lifted = liftRange(['v1'], 1, 5)(p);
    expect(layout(lifted, 'v1')).toEqual([['one', 0, 1, 2], ['*', 5, 8, 11]]);
    const extracted = extractRange(['v1', 'a1'], 1, 5)(p);
    expect(layout(extracted, 'v1')).toEqual([['one', 0, 1, 2], ['*', 1, 4, 11]]);
    expect(layout(extracted, 'a1')).toEqual([['one-a', 0, 1, 2], ['*', 1, 4, 11]]);
  });

  it('ripple delete removes linked clips and closes the gap on their tracks', () => {
    const next = deleteItems(['one'], true)(base());
    expect(layout(next, 'v1')).toEqual([['two', 0, 4, 10]]);
    expect(layout(next, 'a1')).toEqual([['two-a', 0, 4, 10]]);
  });

  it('plain delete leaves a gap on free tracks and the main track', () => {
    const next = deleteItems(['one'], false)(base());
    expect(layout(next, 'v1')).toEqual([['two', 4, 8, 10]]);
    expect(layout(next, 'a1')).toEqual([['two-a', 4, 8, 10]]);
  });

  it('opening a gap moves markers after the point', () => {
    const p = sequence(addMarker({ time: 1, name: 'early' }, 'm1'), addMarker({ time: 5 }, 'm2'))(base());
    expect(openGap(['v1'], 3, 2)(p).markers!.map((m) => m.time)).toEqual([1, 7]);
    expect(extractRange(['v1'], 4, 6)(p).markers!.map((m) => m.id)).toEqual(['m1']);
  });
});

describe('trim modes', () => {
  it('ripple trim of the tail moves everything after it on linked tracks', () => {
    const next = rippleTrim('one', 'out', -1)(base());
    expect(layout(next, 'v1')).toEqual([['one', 0, 3, 2], ['two', 3, 7, 10]]);
    expect(layout(next, 'a1')).toEqual([['one-a', 0, 3, 2], ['two-a', 3, 7, 10]]);
  });

  it('ripple trim of the head keeps the clip in place', () => {
    const next = rippleTrim('two', 'in', 1)(base());
    expect(layout(next, 'v1')).toEqual([['one', 0, 4, 2], ['two', 4, 7, 11]]);
    expect(layout(next, 'a1')).toEqual([['one-a', 0, 4, 2], ['two-a', 4, 7, 11]]);
  });

  it('ripple trim is limited by the source media', () => {
    const next = rippleTrim('one', 'in', -5)(base());
    expect(layout(next, 'v1')[0]).toEqual(['one', 0, 6, 0]);
  });

  it('roll moves the edit point and keeps the total length', () => {
    const next = rollEdit('one', 'out', 1)(base());
    expect(layout(next, 'v1')).toEqual([['one', 0, 5, 2], ['two', 5, 8, 11]]);
    expect(layout(next, 'a1')).toEqual([['one-a', 0, 5, 2], ['two-a', 5, 8, 11]]);
    expect(rollEdit('one', 'out', 100)(base()).tracks[0].items[1]).toMatchObject({ source: { in: 14 - 1 / 120 } });
  });

  it('slip changes the source range only', () => {
    const next = slipEdit('two', 3)(base());
    expect(layout(next, 'v1')).toEqual([['one', 0, 4, 2], ['two', 4, 8, 13]]);
    expect(layout(next, 'a1')[1]).toEqual(['two-a', 4, 8, 13]);
    expect(layout(slipEdit('two', 100)(base()), 'v1')[1][3]).toBe(16);
  });

  it('slide moves a clip between its neighbours', () => {
    const p = sequence(insertItem('b', { trackId: 'v1', in: 0, out: 4, id: 'three' }))(base());
    const next = slideEdit('two', 1)(p);
    expect(layout(next, 'v1')).toEqual([['one', 0, 5, 2], ['two', 5, 9, 10], ['three', 9, 12, 1]]);
  });

  it('works with text on free tracks', () => {
    const p = sequence(insertText('v2', 1, 2, {}, 't1'), insertText('v2', 3, 2, {}, 't2'))(base());
    const next = rollEdit('t1', 'out', 0.5)(p);
    expect(layout(next, 'v2')).toEqual([['t1', 1, 3.5, 0], ['t2', 3.5, 5, 0]]);
  });
});

describe('markers', () => {
  it('adds, edits and removes markers in time order', () => {
    let p = sequence(addMarker({ time: 3, name: 'b' }, 'm2'), addMarker({ time: 1, name: 'a', color: 'red' }, 'm1'))(base());
    expect(p.markers!.map((m) => m.id)).toEqual(['m1', 'm2']);
    p = updateMarker('m1', { time: 5, note: 'n' })(p);
    expect(p.markers!.map((m) => [m.id, m.time, m.note])).toEqual([['m2', 3, ''], ['m1', 5, 'n']]);
    expect(() => addMarker({ time: 0, color: 'beige' })(p)).toThrow(/Unknown marker color/);
    expect(removeMarker('m1')(removeMarker('m2')(p)).markers).toBeUndefined();
  });

  it('placing an item into a free track keeps it independent', () => {
    const p = base();
    const next = placeItem(clip(p, 'b', 0, 1, 'free'), 'v2', { start: 2 })(p);
    expect(insertEdit([{ trackId: 'v1', item: clip(p, 'b', 0, 1, 'x') }], 0)(next).tracks[1].items[0].start).toBe(3);
  });
});
