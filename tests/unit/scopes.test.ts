import { describe, expect, it } from 'vitest';
import { analyze, SCOPE_LEVELS, VECTOR_SIZE } from '../../src/engine/scopes';

const image = (colors: [number, number, number][]) => new Uint8Array(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('scopes.analyze', () => {
  it('counts every pixel once per channel', () => {
    const data = analyze(image([[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]]), 2, 2);
    expect(data.samples).toBe(4);
    expect(data.histogram[255 * 4]).toBe(1);
    expect(data.histogram[255 * 4 + 1]).toBe(1);
    expect(data.histogram[128 * 4 + 3]).toBe(1);
    expect(data.vector.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('places columns by x position', () => {
    const data = analyze(image([[0, 0, 0], [255, 255, 255]]), 2, 1);
    const right = (data.columns / 2) * SCOPE_LEVELS * 4;
    expect(data.waveform[0 * 4 + 3]).toBe(1);
    expect(data.waveform[right + 255 * 4 + 3]).toBe(1);
  });

  it('puts neutral colors at the vectorscope center', () => {
    const data = analyze(image([[100, 100, 100]]), 1, 1);
    const center = Math.round(0.5 * (VECTOR_SIZE - 1));
    expect(data.vector[center * VECTOR_SIZE + center]).toBe(1);
  });
});
