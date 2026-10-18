export interface TimingSummary {
  readonly count: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
}

export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly timings: Readonly<Record<string, TimingSummary>>;
}

const RESERVOIR = 512;

class Timing {
  private samples: number[] = [];
  private count = 0;
  private total = 0;
  private max = 0;

  add(ms: number) {
    this.count++;
    this.total += ms;
    this.max = Math.max(this.max, ms);
    if (this.samples.length < RESERVOIR) this.samples.push(ms);
    else this.samples[Math.floor(Math.random() * this.count) % RESERVOIR] = ms;
  }

  summary(): TimingSummary {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: this.count,
      mean: this.count ? this.total / this.count : 0,
      p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
      max: this.max,
    };
  }
}

export class Metrics {
  private counters = new Map<string, number>();
  private timings = new Map<string, Timing>();

  count(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  time(name: string, ms: number): void {
    let timing = this.timings.get(name);
    if (!timing) this.timings.set(name, (timing = new Timing()));
    timing.add(ms);
  }

  async measure<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.time(name, performance.now() - start);
    }
  }

  reset(): void {
    this.counters.clear();
    this.timings.clear();
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      timings: Object.fromEntries([...this.timings].map(([k, v]) => [k, v.summary()])),
    };
  }
}

export const metrics = new Metrics();
