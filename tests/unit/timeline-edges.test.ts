import { describe, expect, it } from 'vitest';
import { emptyProject } from '../../src/core/model';
import { addAsset, insertItem, insertText, sequence, setTrackMuted, setTransition } from '../../src/core/operations';
import { audibleAt, compositionAt, placeTrack, projectDuration, trackFrameAt } from '../../src/core/timeline';
import { asset } from './fixtures';

const two = (transition: number) =>
  sequence(
    addAsset(asset('a', 10)),
    insertItem('a', { trackId: 'v1', in: 0, out: 2, id: 'one' }),
    insertItem('a', { trackId: 'v1', in: 0, out: 6, id: 'two' }),
    setTransition('two', { type: 'dissolve', duration: transition, params: {} }),
  )(emptyProject());

describe('timeline edges', () => {
  it('caps transitions by the shorter neighbour', () => {
    const p = two(100);
    const [, second] = placeTrack(p.tracks[0]);
    expect(second.fadeIn).toBeGreaterThan(0);
    expect(second.fadeIn).toBeLessThan(2);
    expect(projectDuration(p)).toBeCloseTo(8 - second.fadeIn);
  });

  it('reports transition progress across the overlap', () => {
    const p = two(1);
    const [, second] = placeTrack(p.tracks[0]);
    const mid = trackFrameAt(p.tracks[0], second.start + second.fadeIn / 2)!;
    expect(mid.transition?.progress).toBeCloseTo(0.5);
    expect(trackFrameAt(p.tracks[0], 100)).toBeNull();
  });

  it('skips muted tracks in composition and audio', () => {
    const p = sequence(insertText('v2', 0, 1, {}, 't'), setTrackMuted('v2', true), setTrackMuted('v1', true))(two(0));
    expect(compositionAt(p, 0.5).layers).toHaveLength(0);
    expect(audibleAt(p, 0, 10)).toHaveLength(0);
  });

  it('treats item ends as exclusive', () => {
    const p = two(0);
    expect(trackFrameAt(p.tracks[0], 2)!.base.placement.item.id).toBe('two');
    expect(audibleAt(p, 2, 3).map((x) => x.item.id)).toEqual(['two']);
  });

  it('caches placements per track instance', () => {
    const p = two(0);
    expect(placeTrack(p.tracks[0])).toBe(placeTrack(p.tracks[0]));
  });
});
