import { describe, expect, it } from 'vitest';
import { MemoryGovernor, type MemoryConsumer } from '../../src/engine/memory';

const consumer = (name: string, initial: number, floor = 0) => {
  let bytes = initial;
  const trims: number[] = [];
  const c: MemoryConsumer & { trims: number[]; set(v: number): void } = {
    name,
    bytes: () => bytes,
    trim: (keep) => {
      trims.push(keep);
      bytes = Math.max(floor, Math.round(initial * keep));
    },
    trims,
    set: (v) => (bytes = v),
  };
  return c;
};

describe('MemoryGovernor', () => {
  it('stays quiet under the elevated threshold', () => {
    const cache = consumer('cache', 50);
    const governor = new MemoryGovernor(100, () => cache.bytes());
    governor.register(cache);
    expect(governor.check()).toBe('normal');
    expect(cache.trims).toEqual([]);
  });

  it('trims caches by half when elevated and recovers', () => {
    const cache = consumer('cache', 80);
    const levels: string[] = [];
    const governor = new MemoryGovernor(100, () => cache.bytes());
    governor.register(cache);
    governor.on('pressure', (e) => levels.push(e.level));
    expect(governor.check()).toBe('normal');
    expect(cache.trims).toEqual([0.5]);
    expect(levels).toEqual([]);
  });

  it('empties caches and halves preview when critical memory is held elsewhere', () => {
    const cache = consumer('cache', 30);
    let pinnedBytes = 0;
    const governor = new MemoryGovernor(100, () => cache.bytes() + 72 + pinnedBytes);
    governor.register(cache);
    const events: string[] = [];
    governor.on('pressure', (e) => events.push(e.level));
    expect(governor.check()).toBe('elevated');
    expect(cache.trims).toEqual([0]);
    expect(governor.previewScale).toBe(1);
    const pinned = consumer('pinned', 40, 40);
    governor.register(pinned);
    pinnedBytes = 40;
    governor.check();
    expect(governor.level).toBe('critical');
    expect(governor.previewScale).toBe(0.5);
    expect(events).toEqual(['elevated', 'critical']);
    expect(governor.report().consumers).toEqual({ cache: 0, pinned: 40 });
  });

  it('unregisters consumers', () => {
    const cache = consumer('cache', 95);
    const governor = new MemoryGovernor(100, () => 95);
    governor.register(cache)();
    governor.check();
    expect(cache.trims).toEqual([]);
  });
});
