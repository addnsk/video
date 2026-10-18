import { describe, expect, it } from 'vitest';
import { EASINGS, shiftAnimations, valueAt } from '../../src/core/animation';
import type { Easing, Keyframe } from '../../src/core/model';

const easings = Object.keys(EASINGS) as Easing[];

describe('cutting keyframed animation', () => {
  for (const ease of easings) {
    it(`keeps the exact ${ease} curve on both sides of one or two cuts`, () => {
      const keys: Keyframe[] = [{ t: 0, v: 0, ease }, { t: 4, v: 10, ease }, { t: 6, v: -2 }];
      for (const [offset, length] of [[1.3, 10], [0, 2.7], [1.1, 1.9], [3.5, 1.2]]) {
        const cut = shiftAnimations({ p: keys }, offset, length).p;
        for (let t = 0; t <= length; t += 0.05) expect(valueAt(cut, t, 0)).toBeCloseTo(valueAt(keys, offset + t, 0), 9);
        const again = shiftAnimations({ p: cut }, 0.4, Math.max(0.1, length - 0.6)).p;
        for (let t = 0; t <= length - 0.6; t += 0.05) expect(valueAt(again, t, 0)).toBeCloseTo(valueAt(keys, offset + 0.4 + t, 0), 9);
      }
    });
  }

  it('holds the value when the window lies outside the keys', () => {
    const keys: Keyframe[] = [{ t: 1, v: 3 }, { t: 2, v: 5 }];
    expect(valueAt(shiftAnimations({ p: keys }, 5, 1).p, 0.5, 0)).toBe(5);
    expect(valueAt(shiftAnimations({ p: keys }, -3, 1).p, 0.5, 0)).toBe(3);
  });
});
