import { Emitter } from '../core/emitter';
import { Store } from '../core/store';
import { sourceProject, type MarkRange } from '../core/three-point';
import type { EngineClient } from './engine-client';
import { Transport } from './transport';

export type Viewer = 'timeline' | 'source';

export interface SourceMonitorEvents extends Record<string, unknown> {
  change: SourceState;
}

export interface SourceState {
  readonly assetId: string | null;
  readonly viewer: Viewer;
  readonly marks: MarkRange;
}

export class SourceMonitor extends Emitter<SourceMonitorEvents> {
  readonly store = new Store();
  readonly transport: Transport;
  private asset: string | null = null;
  private active: Viewer = 'timeline';
  private ranges = new Map<string, MarkRange>();

  constructor(
    private engine: EngineClient,
    private timeline: Store,
    private timelineTransport: Transport,
  ) {
    super();
    this.transport = new Transport(engine, this.store);
    timeline.on('change', ({ project }) => {
      if (this.asset && !project.assets[this.asset]) this.close();
    });
  }

  get assetId(): string | null {
    return this.asset;
  }

  get viewer(): Viewer {
    return this.active;
  }

  get marks(): MarkRange {
    return (this.asset && this.ranges.get(this.asset)) || {};
  }

  get state(): SourceState {
    return { assetId: this.asset, viewer: this.active, marks: this.marks };
  }

  open(assetId: string): void {
    const project = sourceProject(this.timeline.project, assetId);
    const changed = assetId !== this.asset;
    this.asset = assetId;
    this.store.dispatch(() => project, { history: false });
    this.show('source');
    if (changed) this.transport.seek(this.marks.in ?? 0);
    this.emit('change', this.state);
  }

  close(): void {
    if (!this.asset) return;
    this.transport.pause();
    this.asset = null;
    this.show('timeline');
    this.emit('change', this.state);
  }

  show(viewer: Viewer): void {
    if (viewer === 'source' && !this.asset) return;
    if (viewer === this.active) return;
    this.active = viewer;
    (viewer === 'source' ? this.timelineTransport : this.transport).pause();
    void this.engine.remote.setSource(viewer === 'source' ? this.store.project : null);
    const transport = viewer === 'source' ? this.transport : this.timelineTransport;
    transport.seek(transport.time);
    this.emit('change', this.state);
  }

  mark(range: { in?: number | null; out?: number | null }): MarkRange {
    if (!this.asset) throw new Error('No clip is open in the source viewer');
    const meta = this.timeline.project.assets[this.asset];
    const clamp = (t: number) => Math.min(meta.end - meta.start, Math.max(0, t));
    const next: { in?: number; out?: number } = { ...this.marks };
    for (const key of ['in', 'out'] as const) {
      const value = range[key];
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = clamp(value);
    }
    this.ranges.set(this.asset, next);
    this.emit('change', this.state);
    return next;
  }
}

export class TimelineMarks extends Emitter<{ change: MarkRange }> {
  private range: MarkRange = {};

  get value(): MarkRange {
    return this.range;
  }

  set(range: { in?: number | null; out?: number | null }): MarkRange {
    const next: { in?: number; out?: number } = { ...this.range };
    for (const key of ['in', 'out'] as const) {
      const value = range[key];
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = Math.max(0, value);
    }
    this.range = next;
    this.emit('change', next);
    return next;
  }

  clear(): void {
    this.set({ in: null, out: null });
  }
}
