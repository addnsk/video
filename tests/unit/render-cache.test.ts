import { describe, expect, it } from 'vitest';
import { emptyProject, type Project } from '../../src/core/model';
import { createMediaItem } from '../../src/core/operations';
import { compositionAt } from '../../src/core/timeline';
import { frameKey } from '../../src/engine/render-cache/frame-key';
import { memoryFrameStore } from '../../src/engine/render-cache/frame-store';
import { RenderCache, type FrameEncoder } from '../../src/engine/render-cache/render-cache';

const asset = { id: 'a', name: 'a', width: 640, height: 360, fps: 25, start: 0, end: 4, hasVideo: true, hasAudio: false } as never;

const project = (exposure = 0): Project => {
  const item = { ...createMediaItem(asset, { id: 'clip' }), effects: [{ id: 'g', type: 'grade', enabled: true, params: { exposure } }] };
  const base = emptyProject();
  return { ...base, settings: { width: 640, height: 360, fps: 25, sampleRate: 48000 }, assets: { a: asset }, tracks: [{ ...base.tracks[0], items: [item] }, ...base.tracks.slice(1)] };
};

const context = { width: 640, height: 360, bypass: false, viewNode: null, generation: 0 };

describe('frame keys', () => {
  it('are stable for the same frame and change with time, params and context', () => {
    const key = frameKey(compositionAt(project(), 1), context);
    expect(frameKey(compositionAt(project(), 1), context)).toBe(key);
    expect(frameKey(compositionAt(project(), 1.04), context)).not.toBe(key);
    expect(frameKey(compositionAt(project(0.5), 1), context)).not.toBe(key);
    expect(frameKey(compositionAt(project(), 1), { ...context, bypass: true })).not.toBe(key);
    expect(frameKey(compositionAt(project(), 1), { ...context, generation: 1 })).not.toBe(key);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });
});

const fakeBitmap = (id: number) => {
  const bitmap = { id, width: 10, height: 10, closed: false, close() { bitmap.closed = true; } };
  return bitmap as unknown as ImageBitmap & { id: number; closed: boolean };
};

const encoder: FrameEncoder = {
  encode: async (bitmap) => new Blob([String((bitmap as unknown as { id: number }).id)]),
  decode: async (blob) => fakeBitmap(Number(await blob.text())),
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('render cache', () => {
  it('keeps frames within the memory limit and spills evicted frames to the store', async () => {
    const cache = new RenderCache({ memoryBytes: 800, diskBytes: 1000 }, memoryFrameStore(), encoder);
    cache.put('a', fakeBitmap(1));
    cache.put('b', fakeBitmap(2));
    expect(cache.peek('a')).not.toBeNull();
    cache.put('c', fakeBitmap(3));
    expect(cache.entries.memory).toBe(2);
    await flush();
    expect(cache.onDisk('b')).toBe(true);
    const restored = await cache.load('b');
    expect((restored as unknown as { id: number }).id).toBe(2);
    expect(cache.peek('b')).toBe(restored);
  });

  it('trims under memory pressure and clears everything', async () => {
    const cache = new RenderCache({ memoryBytes: 2000, diskBytes: 1000 }, memoryFrameStore(), encoder);
    for (let i = 0; i < 4; i++) cache.put(`k${i}`, fakeBitmap(i));
    cache.trim(400);
    expect(cache.bytes).toBeLessThanOrEqual(400);
    await flush();
    cache.clear();
    expect(cache.entries).toEqual({ memory: 0, disk: 0 });
    expect(await cache.load('k0')).toBeNull();
  });
});
