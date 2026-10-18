import { describe, expect, it } from 'vitest';
import { alignEnvelopes } from '../../src/effects/audio/sync';

const RATE = 100;
const take = (seconds: number, seed: number) => {
  let s = seed;
  const random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Float32Array.from({ length: seconds * RATE }, (_, i) => (random() > 0.96 ? 0.5 + random() * 0.5 : random() * 0.05));
};

describe('audio sync', () => {
  it('finds where a later camera starts on the reference', () => {
    const scene = take(60, 7);
    const late = scene.slice(1234);
    const result = alignEnvelopes(scene, late, RATE);
    expect(result.offset).toBeCloseTo(12.34, 5);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('finds a camera that started earlier, with its own noise', () => {
    const scene = take(60, 3);
    const early = new Float32Array(scene.length + 500);
    early.set(take(5, 99), 0);
    early.set(scene, 500);
    for (let i = 0; i < early.length; i++) early[i] = early[i] * 0.6 + (i % 13) * 0.002;
    expect(alignEnvelopes(scene, early, RATE).offset).toBeCloseTo(-5, 5);
  });

  it('reports low confidence for unrelated sound', () => {
    expect(alignEnvelopes(take(30, 1), take(30, 2), RATE).confidence).toBeLessThan(0.3);
  });
});
