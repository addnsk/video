import { Emitter } from './emitter';

export type LogLevel = 'error' | 'warning' | 'info';
export type LogSource = 'ui' | 'engine' | 'media' | 'export' | 'script' | 'storage';

export interface LogEntry {
  readonly time: string;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly message: string;
  readonly stack?: string;
  readonly count: number;
}

export interface LogStore {
  load(): LogEntry[];
  save(entries: readonly LogEntry[]): void;
}

export interface LogEvents extends Record<string, unknown> {
  entry: LogEntry;
  clear: void;
}

const REPEAT_WINDOW_MS = 5000;

export class EventLog extends Emitter<LogEvents> {
  private items: LogEntry[];

  constructor(
    private capacity = 200,
    private store: LogStore | null = null,
    private now: () => Date = () => new Date(),
  ) {
    super();
    this.items = store?.load().slice(-capacity) ?? [];
  }

  record(level: LogLevel, source: LogSource, message: string, stack?: string): LogEntry {
    const time = this.now();
    const last = this.items.at(-1);
    if (last && last.message === message && last.source === source && time.getTime() - Date.parse(last.time) < REPEAT_WINDOW_MS) {
      const merged = { ...last, time: time.toISOString(), count: last.count + 1 };
      this.items[this.items.length - 1] = merged;
      this.persist();
      this.emit('entry', merged);
      return merged;
    }
    const entry: LogEntry = { time: time.toISOString(), level, source, message, ...(stack ? { stack } : {}), count: 1 };
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    this.persist();
    this.emit('entry', entry);
    return entry;
  }

  error(source: LogSource, error: unknown): LogEntry {
    const { message, stack } = describeError(error);
    return this.record('error', source, message, stack);
  }

  entries(): readonly LogEntry[] {
    return this.items;
  }

  get errorCount(): number {
    return this.items.filter((e) => e.level === 'error').length;
  }

  clear(): void {
    this.items = [];
    this.persist();
    this.emit('clear', undefined);
  }

  report(context: Record<string, unknown>): string {
    return JSON.stringify({ generated: this.now().toISOString(), context, entries: this.items }, null, 2);
  }

  private persist() {
    try {
      this.store?.save(this.items);
    } catch {}
  }
}

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}`, stack: error.stack };
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}
