import { describe, expect, it } from 'vitest';
import { FLAT_CURVE, IDENTITY_CURVE, sampleCurve } from '../../src/effects/curves';

describe('curve sampling', () => {
  it('keeps the identity curve straight', () => {
    const s = sampleCurve(IDENTITY_CURVE, 11);
    s.forEach((v, i) => expect(v).toBeCloseTo(i / 10, 5));
  });

  it('keeps a flat curve flat', () => {
    sampleCurve(FLAT_CURVE, 16, true).forEach((v) => expect(v).toBeCloseTo(0.5, 5));
  });

  it('passes through control points and stays monotone', () => {
    const s = sampleCurve([0, 0, 0.25, 0.4, 0.75, 0.8, 1, 1], 101);
    expect(s[25]).toBeCloseTo(0.4, 2);
    expect(s[75]).toBeCloseTo(0.8, 2);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] - 1e-6);
  });

  it('accepts unsorted points', () => {
    expect(sampleCurve([1, 1, 0, 0], 3)[1]).toBeCloseTo(0.5, 5);
  });
});
