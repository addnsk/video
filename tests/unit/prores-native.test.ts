import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProresFrameEncoder, type Planes422 } from '../../src/engine/export/prores/encoder';
import { instantiateNativeCoder } from '../../src/engine/export/prores/native-coder';
import { PRORES_PROFILES } from '../../src/engine/export/prores/tables';

const wasm = readFileSync(new URL('../../src/engine/export/prores/prores.wasm', import.meta.url));

const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const planes = (width: number, height: number, kind: 'noise' | 'smooth' | 'extreme', seed: number): Planes422 => {
  const next = random(seed);
  const fill = (w: number, base: number) =>
    Uint16Array.from({ length: w * height }, (_, i) => {
      const x = i % w;
      const y = Math.floor(i / w);
      if (kind === 'noise') return Math.floor(next() * 1024);
      if (kind === 'extreme') return (x >> 2) % 2 === (y >> 2) % 2 ? 1023 : 0;
      return Math.round(base + 300 * Math.sin(x / 9) * Math.cos(y / 13) + next() * 8);
    });
  return { width, height, y: fill(width, 512), cb: fill(width >> 1, 500), cr: fill(width >> 1, 530) };
};

describe('native prores slice coder', () => {
  const cases = [
    [200, 120, 'smooth'],
    [64, 32, 'noise'],
    [376, 50, 'extreme'],
    [1920, 1080, 'smooth'],
    [720, 486, 'noise'],
  ] as const;
  for (const [width, height, kind] of cases) {
    it(`matches the script encoder byte for byte on ${kind} ${width}x${height}`, async () => {
      const coder = await instantiateNativeCoder(wasm);
      for (const profile of PRORES_PROFILES) {
        const input = planes(width, height, kind, width + height);
        const expected = new ProresFrameEncoder(profile).encode(input);
        const actual = new ProresFrameEncoder(profile, undefined, coder).encode(input);
        expect(actual.length).toBe(expected.length);
        expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected))).toBe(0);
      }
    }, 60000);
  }
});

describe('quantizer search', () => {
  it('finds the smallest fitting step from any start when cost falls with the step', async () => {
    const { searchQuant } = await import('../../src/engine/export/prores/encoder');
    for (let threshold = 0; threshold <= 23; threshold++) {
      for (let start = -2; start <= 26; start++) {
        expect(searchQuant(start, 0, 23, (i) => i >= threshold)).toBe(threshold);
      }
    }
    expect(searchQuant(5, 0, 23, () => false)).toBe(23);
  });
});
