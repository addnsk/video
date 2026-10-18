import { describe, expect, it } from 'vitest';
import { EASINGS, PROPERTY, valueAt } from '../../src/core/animation';
import { resolveItem } from '../../src/core/resolve';
import { emptyProject, type Project } from '../../src/core/model';
import { insertText, sequence, setDuration, setItemProps, setKeyframe, setPreset, splitAt } from '../../src/core/operations';
import { ANIMATION_PRESETS, animationPreset, effectiveAnimations, presetWindow } from '../../src/core/presets';

const preset = (id: string) => animationPreset(id)!;
const title = (duration = 4) => insertText('v2', 0, duration, { content: 'Hi' }, 't')(emptyProject());
const item = (p: Project) => p.tracks.flatMap((t) => t.items).find((i) => i.id === 't')!;

describe('easing', () => {
  it('maps the unit interval onto itself', () => {
    for (const ease of Object.values(EASINGS)) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
    expect(EASINGS.out(0.5)).toBeGreaterThan(0.5);
    expect(EASINGS.in(0.5)).toBeLessThan(0.5);
  });

  it('applies the easing of the segment start key', () => {
    const keys = [{ t: 0, v: 0, ease: 'out' as const }, { t: 1, v: 1 }];
    expect(valueAt(keys, 0.5, 0)).toBeCloseTo(EASINGS.out(0.5));
  });
});

describe('animation presets', () => {
  it('have unique ids and sane phases', () => {
    expect(new Set(ANIMATION_PRESETS.map((p) => p.id)).size).toBe(ANIMATION_PRESETS.length);
    for (const p of ANIMATION_PRESETS) for (const c of p.channels) expect(c.keys[0].at).toBe(0);
  });

  it('builds windows that fit short items', () => {
    expect(presetWindow(preset('fade-in'), 4)).toEqual([0, 0.5]);
    expect(presetWindow(preset('fade-out'), 4)).toEqual([3.5, 4]);
    expect(presetWindow(preset('fade-in'), 0.5)[1]).toBeCloseTo(0.225);
    expect(presetWindow(preset('ken-burns'), 3)).toEqual([0, 3]);
  });

  it('combines in and out presets around the base value', () => {
    const p = sequence(setItemProps('t', { opacity: 0.8, transform: { y: 0.3 } }), setPreset('t', 'in', 'rise'), setPreset('t', 'out', 'fade-out'))(title());
    const t = item(p);
    expect(t.animations).toEqual({});
    expect(resolveItem(t, 0).opacity).toBe(0);
    expect(resolveItem(t, 0).transform.y).toBeCloseTo(0.38);
    expect(resolveItem(t, 2).opacity).toBeCloseTo(0.8);
    expect(resolveItem(t, 2).transform.y).toBeCloseTo(0.3);
    expect(resolveItem(t, 4).opacity).toBe(0);
  });

  it('follows length changes and overrides user keys only inside the window', () => {
    const p = sequence(setKeyframe('t', PROPERTY.opacity, 2, 0.5), setPreset('t', 'out', 'fade-out'), setDuration('t', 6))(title());
    const keys = effectiveAnimations(item(p))[PROPERTY.opacity];
    expect(keys.map((k) => k.t)).toEqual([2, 5.5, 6]);
    expect(resolveItem(item(p), 6).opacity).toBe(0);
  });

  it('caches resolved animations per item and clears presets', () => {
    const p = setPreset('t', 'whole', 'ken-burns')(title());
    expect(effectiveAnimations(item(p))).toBe(effectiveAnimations(item(p)));
    expect(resolveItem(item(p), 4).transform.scale).toBeCloseTo(1.12);
    const cleared = setPreset('t', 'whole', null)(p);
    expect(item(cleared).presets).toEqual({});
    expect(setPreset('t', 'whole', null)(cleared)).toBe(cleared);
  });

  it('ignores presets of another phase or unknown ids', () => {
    const p = sequence(setPreset('t', 'in', 'fade-out'), setPreset('t', 'out', 'missing'))(title());
    expect(effectiveAnimations(item(p))).toEqual({});
  });

  it('keeps the in preset on the left and the out preset on the right after a split', () => {
    const p = sequence(setPreset('t', 'in', 'pop'), setPreset('t', 'out', 'sink'), setPreset('t', 'whole', 'drift'), splitAt(2, 'v2', 'r'))(title());
    const [left, right] = p.tracks.find((t) => t.id === 'v2')!.items;
    expect(left.presets).toEqual({ in: 'pop', whole: 'drift' });
    expect(right.presets).toEqual({ out: 'sink', whole: 'drift' });
  });
});
