import { describe, expect, it } from 'vitest';
import { budgetFor, detectDevice } from '../../src/engine/device';

const device = (memoryGb: number | null, extra: { ios?: boolean; touch?: boolean } = {}) => ({ memoryGb, cores: 8, ios: false, touch: false, ...extra });

describe('device budgets', () => {
  it('classifies devices', () => {
    expect(budgetFor(device(16)).deviceClass).toBe('desktop');
    expect(budgetFor(device(null)).deviceClass).toBe('desktop');
    expect(budgetFor(device(4)).deviceClass).toBe('mobile');
    expect(budgetFor(device(8, { touch: true })).deviceClass).toBe('mobile');
    expect(budgetFor(device(2)).deviceClass).toBe('constrained');
    expect(budgetFor(device(null, { ios: true })).deviceClass).toBe('constrained');
  });

  it('shrinks budgets on weaker devices', () => {
    const [desktop, mobile, constrained] = [device(16), device(4), device(2)].map(budgetFor);
    expect(desktop.frameCacheBytes).toBeGreaterThan(mobile.frameCacheBytes);
    expect(mobile.frameCacheBytes).toBeGreaterThan(constrained.frameCacheBytes);
    expect(constrained.previewMaxHeight).toBeLessThanOrEqual(mobile.previewMaxHeight);
    expect(constrained.maxOpenSources).toBeLessThan(desktop.maxOpenSources);
  });

  it('detects iPadOS posing as Mac', () => {
    const nav = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5, hardwareConcurrency: 6 } as Navigator;
    const info = detectDevice(nav);
    expect(info.ios).toBe(true);
    expect(info.touch).toBe(true);
    expect(info.memoryGb).toBeNull();
  });
});
