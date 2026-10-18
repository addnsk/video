import { describe, expect, it } from 'vitest';
import { AssetDataCache } from '../../src/host/asset-data';

const flush = () => new Promise((r) => setTimeout(r, 0));

const setup = (capacity = Infinity, failing = new Set<string>()) => {
  const loads: string[] = [];
  const disposed: string[] = [];
  const ready: string[] = [];
  const cache = new AssetDataCache<string>(
    {
      available: (id) => !id.startsWith('missing'),
      load: async (id) => {
        loads.push(id);
        if (failing.has(id)) throw new Error('nope');
        return `data:${id}`;
      },
      dispose: (v) => disposed.push(v),
    },
    (id) => ready.push(id),
    capacity,
  );
  return { cache, loads, disposed, ready };
};

describe('AssetDataCache', () => {
  it('loads once and notifies', async () => {
    const { cache, loads, ready } = setup();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('a')).toBeNull();
    await flush();
    expect(cache.get('a')).toBe('data:a');
    expect(loads).toEqual(['a']);
    expect(ready).toEqual(['a']);
  });

  it('skips unavailable assets without caching them', () => {
    const { cache, loads } = setup();
    expect(cache.get('missing-1')).toBeNull();
    expect(loads).toEqual([]);
  });

  it('retries after a failed load', async () => {
    const failing = new Set(['a']);
    const { cache, loads } = setup(Infinity, failing);
    cache.get('a');
    await flush();
    failing.clear();
    cache.get('a');
    await flush();
    expect(cache.get('a')).toBe('data:a');
    expect(loads).toEqual(['a', 'a']);
  });

  it('evicts least recently used values and disposes them', async () => {
    const { cache, disposed } = setup(2);
    cache.get('a');
    cache.get('b');
    await flush();
    cache.get('a');
    cache.get('c');
    await flush();
    expect(disposed).toEqual(['data:b']);
    expect(cache.get('a')).toBe('data:a');
  });

  it('disposes values that arrive after invalidation', async () => {
    const { cache, disposed, ready } = setup();
    cache.get('a');
    cache.invalidate('a');
    await flush();
    expect(disposed).toEqual(['data:a']);
    expect(ready).toEqual([]);
  });
});
