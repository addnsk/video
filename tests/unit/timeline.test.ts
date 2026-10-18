import { describe, expect, it } from 'vitest';
import { emptyProject } from '../../src/core/model';
import { addAsset, insertItem, moveItem, removeItem, sequence, setTransition, splitAt, trimItem } from '../../src/core/operations';
import { compositionAt, placeTrack, projectDuration } from '../../src/core/timeline';
import { asset } from './fixtures';

const build = () =>
  sequence(
    addAsset(asset('a', 10)),
    insertItem('a', { trackId: 'v1', in: 0, out: 4, id: 'one' }),
    insertItem('a', { trackId: 'v1', in: 5, out: 8, id: 'two' }),
  )(emptyProject());

describe('magnetic track', () => {
  it('places items back to back', () => {
    const project = build();
    const placements = placeTrack(project.tracks[0]);
    expect(placements.map((p) => [p.start, p.end])).toEqual([[0, 4], [4, 7]]);
    expect(projectDuration(project)).toBe(7);
  });

  it('overlaps items by the transition length', () => {
    const project = setTransition('two', { type: 'dissolve', duration: 1, params: {} })(build());
    expect(projectDuration(project)).toBe(6);
    const frame = compositionAt(project, 3.5);
    expect(frame.layers[0].transition?.progress).toBeCloseTo(0.5);
    expect(frame.layers[0].transition?.incoming.sourceTime).toBeCloseTo(5.5);
  });

  it('caps transitions to the shorter neighbour', () => {
    const project = setTransition('two', { type: 'dissolve', duration: 30, params: {} })(build());
    expect(placeTrack(project.tracks[0])[1].fadeIn).toBeCloseTo(2.7);
  });

  it('splits at the playhead and keeps both halves contiguous', () => {
    const project = splitAt(1.5, 'v1', 'right')(build());
    const placements = placeTrack(project.tracks[0]);
    expect(placements.map((p) => p.item.id)).toEqual(['one', 'right', 'two']);
    expect(placements[1].item.source.in).toBeCloseTo(1.5);
    expect(projectDuration(project)).toBe(7);
  });

  it('clamps trims to the source', () => {
    const project = trimItem('one', { in: -5, out: 99 })(build());
    expect(placeTrack(project.tracks[0])[0].item.source).toMatchObject({ in: 0, out: 10 });
  });

  it('drops a dangling transition when the first item is removed', () => {
    const project = removeItem('one')(setTransition('two', { type: 'dissolve', duration: 1, params: {} })(build()));
    expect(project.tracks[0].items[0].transitionIn).toBeNull();
  });

  it('reorders items', () => {
    const project = moveItem('two', 0)(build());
    expect(project.tracks[0].items.map((i) => i.id)).toEqual(['two', 'one']);
  });

  it('returns the same object for no-op operations', () => {
    const project = build();
    expect(splitAt(100, 'v1')(project)).toBe(project);
  });
});
