import { Emitter } from './emitter';
import type { Project } from './model';
import { emptyProject } from './model';
import type { Operation } from './operations';

export interface StoreEvents extends Record<string, unknown> {
  change: { project: Project; previous: Project };
}

interface HistoryEntry {
  project: Project;
  key: string | null;
  at: number;
}

export interface DispatchOptions {
  coalesce?: string;
  history?: boolean;
}

const COALESCE_WINDOW_MS = 800;
const HISTORY_LIMIT = 300;

export class Store extends Emitter<StoreEvents> {
  private current: Project;
  private past: HistoryEntry[] = [];
  private future: Project[] = [];
  private transactionDepth = 0;
  private transactionBase: Project | null = null;

  constructor(initial: Project = emptyProject()) {
    super();
    this.current = initial;
  }

  get project(): Project {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  dispatch(op: Operation, options: DispatchOptions = {}): Project {
    const previous = this.current;
    const next = op(previous);
    if (next === previous) return next;
    if (options.history !== false && this.transactionDepth === 0) this.record(previous, options.coalesce ?? null);
    this.current = next;
    this.emit('change', { project: next, previous });
    return next;
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.transactionDepth++ === 0) this.transactionBase = this.current;
    try {
      return await fn();
    } finally {
      if (--this.transactionDepth === 0) {
        const base = this.transactionBase!;
        this.transactionBase = null;
        if (base !== this.current) this.record(base, null);
      }
    }
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push(this.current);
    this.replace(entry.project);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push({ project: this.current, key: null, at: 0 });
    this.replace(next);
    return true;
  }

  reset(project: Project): void {
    this.past = [];
    this.future = [];
    this.replace(project);
  }

  private replace(project: Project) {
    const previous = this.current;
    this.current = project;
    this.emit('change', { project, previous });
  }

  private record(previous: Project, key: string | null) {
    const now = performance.now();
    const last = this.past.at(-1);
    this.future = [];
    if (key && last?.key === key && now - last.at < COALESCE_WINDOW_MS) {
      last.at = now;
      return;
    }
    this.past.push({ project: previous, key, at: now });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }
}
