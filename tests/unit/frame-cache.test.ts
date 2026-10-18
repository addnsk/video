import { describe, expect, it } from 'vitest';
import type { OwnedFrame } from '../../src/engine/media/frame';
import { frameBytes } from '../../src/engine/media/frame';
import { FrameCache } from '../../src/engine/media/frame-cache';

const released: string[] = [];
const frame = (key: string): OwnedFrame => ({
  source: {} as TexImageSource,
  width: 10,
  height: 10,
  timestamp: 0,
  key,
  release: () => released.push(key),
});
const unit = frameBytes(frame('probe'));

describe('FrameCache', () => {
  it('evicts least recently used frames over capacity', () => {
    released.length = 0;
    const cache = new FrameCache(unit * 2);
    cache.put('a', frame('a'));
    cache.put('b', frame('b'));
    cache.get('a');
    cache.put('c', frame('c'));
    expect(released).toEqual(['b']);
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(unit * 2);
  });

  it('keeps pinned frames', () => {
    released.length = 0;
    const cache = new FrameCache(unit * 2);
    cache.put('a', frame('a'));
    cache.put('b', frame('b'));
    cache.put('c', frame('c'), new Set(['a']));
    expect(released).toEqual(['b']);
    expect(cache.get('a')).toBeDefined();
  });

  it('releases replaced and oversized frames', () => {
    released.length = 0;
    const cache = new FrameCache(unit);
    cache.put('a', frame('a1'));
    cache.put('a', frame('a2'));
    expect(released).toEqual(['a1']);
    new FrameCache(unit - 1).put('x', frame('x'));
    expect(released).toEqual(['a1', 'x']);
  });

  it('trims down to a byte target, keeping pinned frames', () => {
    released.length = 0;
    const cache = new FrameCache(unit * 4);
    for (const k of ['a', 'b', 'c', 'd']) cache.put(k, frame(k));
    cache.trim(unit, new Set(['a']));
    expect(released).toEqual(['b', 'c', 'd']);
    expect(cache.size).toBe(unit);
    expect(cache.capacityBytes).toBe(unit * 4);
  });

  it('clear releases everything', () => {
    released.length = 0;
    const cache = new FrameCache(unit * 4);
    cache.put('a', frame('a'));
    cache.put('b', frame('b'));
    cache.clear();
    expect(released.sort()).toEqual(['a', 'b']);
    expect(cache.size).toBe(0);
  });
});
