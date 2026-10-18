import { describe, expect, it } from 'vitest';
import { hsvOf, qualifierFromColor } from '../../src/effects/qualifier-pick';

describe('qualifier pick', () => {
  it('centers the HSL qualifier on the picked color', () => {
    const p = qualifierFromColor('qualifier', [0.2, 0.6, 0.2], {});
    expect(p.hueCenter).toBeCloseTo(1 / 3, 6);
    expect(p.satLow).toBeCloseTo(hsvOf([0.2, 0.6, 0.2])[1] - 0.15, 6);
    expect(p.useLum).toBe(true);
  });

  it('fills 3D qualifier keys: replace by default, next free slot when adding', () => {
    const defaults = { key1: [0.8, 0.2, 0.2, 1], key2: [0, 0, 0, 0], key3: [0, 0, 0, 0] };
    expect(qualifierFromColor('qualifier-3d', [0.1, 0.2, 0.3], defaults)).toEqual({ key1: [0.1, 0.2, 0.3, 1], key2: [0, 0, 0, 0], key3: [0, 0, 0, 0] });
    expect(qualifierFromColor('qualifier-3d', [0.1, 0.2, 0.3], defaults, true)).toEqual({ key2: [0.1, 0.2, 0.3, 1] });
  });
});
