import { Emitter } from '../core/emitter';

export type Pressure = 'normal' | 'elevated' | 'critical';

export interface MemoryConsumer {
  readonly name: string;
  bytes(): number;
  trim(keepFraction: number): void;
}

export interface GovernorEvents extends Record<string, unknown> {
  pressure: { level: Pressure; bytes: number; limit: number };
}

export interface PressureThresholds {
  readonly elevated: number;
  readonly critical: number;
}

const DEFAULT_THRESHOLDS: PressureThresholds = { elevated: 0.7, critical: 0.9 };
const KEEP: Record<Pressure, number> = { normal: 1, elevated: 0.5, critical: 0 };
const PREVIEW_SCALE: Record<Pressure, number> = { normal: 1, elevated: 1, critical: 0.5 };

export class MemoryGovernor extends Emitter<GovernorEvents> {
  private consumers: MemoryConsumer[] = [];
  private current: Pressure = 'normal';

  constructor(
    readonly limit: number,
    private measure: () => number,
    private thresholds: PressureThresholds = DEFAULT_THRESHOLDS,
  ) {
    super();
  }

  register(consumer: MemoryConsumer): () => void {
    this.consumers.push(consumer);
    return () => {
      this.consumers = this.consumers.filter((c) => c !== consumer);
    };
  }

  get level(): Pressure {
    return this.current;
  }

  get previewScale(): number {
    return PREVIEW_SCALE[this.current];
  }

  check(): Pressure {
    let level = this.classify(this.measure());
    if (level !== 'normal') {
      for (const consumer of this.consumers) consumer.trim(KEEP[level]);
      level = this.classify(this.measure());
    }
    if (level !== this.current) {
      this.current = level;
      this.emit('pressure', { level, bytes: this.measure(), limit: this.limit });
    }
    return level;
  }

  report(): { level: Pressure; bytes: number; limit: number; consumers: Record<string, number> } {
    return {
      level: this.current,
      bytes: this.measure(),
      limit: this.limit,
      consumers: Object.fromEntries(this.consumers.map((c) => [c.name, c.bytes()])),
    };
  }

  private classify(bytes: number): Pressure {
    const ratio = bytes / this.limit;
    return ratio >= this.thresholds.critical ? 'critical' : ratio >= this.thresholds.elevated ? 'elevated' : 'normal';
  }
}
