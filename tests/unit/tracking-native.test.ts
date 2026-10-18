import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instantiateNativeScorer } from '../../src/engine/tracking/native-scorer';
import { extractTemplate, matchTemplate, scriptScorer, type LumaFrame } from '../../src/engine/tracking/tracker';

const wasm = readFileSync(new URL('../../src/engine/tracking/matcher.wasm', import.meta.url));

const scene = (width: number, height: number, ox: number, oy: number): LumaFrame => {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x - ox;
      const v = y - oy;
      data[y * width + x] = 128 + 60 * Math.sin(u / 5.3) * Math.cos(v / 3.7) + 40 * Math.sin((u * v) / 97);
    }
  return { width, height, data };
};

describe('native tracking scorer', () => {
  it('scores like the script scorer, including windows that leave the frame', async () => {
    const native = await instantiateNativeScorer(wasm);
    const frame = scene(97, 61, 3, 2);
    for (const size of [5, 8, 21]) {
      const template = extractTemplate(scene(97, 61, 0, 0), 40, 30, size)!;
      const expected = scriptScorer.scores(frame, template, -4, 20, 30);
      const actual = native.scores(frame, template, -4, 20, 30);
      for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 4);
    }
  });

  it('finds the same sub-pixel motion', async () => {
    const native = await instantiateNativeScorer(wasm);
    const template = extractTemplate(scene(160, 120, 0, 0), 80, 60, 21)!;
    const moved = scene(160, 120, 7, -4);
    const a = matchTemplate(moved, template, 80, 60, 16);
    const b = matchTemplate(moved, template, 80, 60, 16, native);
    expect(a.x).toBeCloseTo(87, 0);
    expect(a.y).toBeCloseTo(56, 0);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
    expect(b.confidence).toBeCloseTo(a.confidence, 4);
  });
});
