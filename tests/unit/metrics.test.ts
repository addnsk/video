import { describe, expect, it } from 'vitest';
import { Metrics } from '../../src/engine/metrics';

describe('Metrics', () => {
  it('counts and summarizes timings', async () => {
    const m = new Metrics();
    m.count('a');
    m.count('a', 2);
    for (let i = 1; i <= 100; i++) m.time('t', i);
    await m.measure('slow', () => new Promise((r) => setTimeout(r, 5)));
    const s = m.snapshot();
    expect(s.counters.a).toBe(3);
    expect(s.timings.t).toMatchObject({ count: 100, mean: 50.5, max: 100 });
    expect(s.timings.t.p95).toBeGreaterThanOrEqual(95);
    expect(s.timings.slow.count).toBe(1);
    m.reset();
    expect(m.snapshot()).toEqual({ counters: {}, timings: {} });
  });
});
