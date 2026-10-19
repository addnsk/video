import { Emitter } from '../core/emitter';
import { createId } from '../core/ids';
import { activeTimeline, timelineData } from '../core/timeline-data';
import type { ExportSettings } from '../engine/export/exporter';
import { exportExtension } from '../engine/export/formats';
import type { EditorSession } from './session';

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'failed' | 'canceled';

export interface RenderPreset {
  readonly id: string;
  readonly label: string;
  readonly settings: Omit<ExportSettings, 'timeline' | 'range'>;
}

export const RENDER_PRESETS: readonly RenderPreset[] = [
  { id: 'master', label: 'ProRes 422 HQ', settings: { height: null, quality: 'high', prores: 'hq', dynamicRange: 'sdr' } },
  { id: 'mezzanine', label: 'ProRes 422 LT', settings: { height: null, quality: 'high', prores: 'lt', dynamicRange: 'sdr' } },
  { id: 'web1080', label: 'MP4 1080p', settings: { height: 1080, quality: 'high', prores: null, dynamicRange: 'sdr' } },
  { id: 'web720', label: 'MP4 720p', settings: { height: 720, quality: 'medium', prores: null, dynamicRange: 'sdr' } },
  { id: 'review', label: 'MP4 540p', settings: { height: 540, quality: 'medium', prores: null, dynamicRange: 'sdr' } },
];

export interface RenderJobSpec {
  readonly timeline?: string;
  readonly preset?: string;
  readonly settings?: Partial<ExportSettings>;
  readonly name?: string;
}

export interface RenderJob {
  readonly id: string;
  readonly name: string;
  readonly timeline: string;
  readonly settings: ExportSettings;
  status: RenderStatus;
  progress: number;
  file: File | null;
  error: string | null;
}

export interface RenderQueueEvents extends Record<string, unknown> {
  change: readonly RenderJob[];
}

const FOLDER = 'render-queue';

const safe = (text: string) => text.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim() || 'render';

export class RenderQueue extends Emitter<RenderQueueEvents> {
  private items: RenderJob[] = [];
  private running: Promise<void> | null = null;
  private signal: { canceled: boolean } | null = null;
  private stopped = false;

  constructor(private session: EditorSession) {
    super();
  }

  get jobs(): readonly RenderJob[] {
    return this.items;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  add(spec: RenderJobSpec = {}): RenderJob {
    const project = this.session.store.project;
    const timeline = spec.timeline ?? activeTimeline(project).id;
    const data = timelineData(project, timeline);
    if (!data) throw new Error(`Unknown timeline ${timeline}`);
    const preset = spec.preset ? RENDER_PRESETS.find((p) => p.id === spec.preset) : null;
    if (spec.preset && !preset) throw new Error(`Unknown render preset ${spec.preset}`);
    const base = preset?.settings ?? RENDER_PRESETS[2].settings;
    const settings: ExportSettings = { ...base, range: null, ...spec.settings, timeline };
    const label = preset?.label ?? (settings.prores ? `ProRes ${settings.prores}` : `${settings.height ?? 'source'}p`);
    const name = this.uniqueName(`${safe(spec.name ?? `${data.name} ${label}`)}.${exportExtension(settings)}`);
    const job: RenderJob = { id: createId('render'), name, timeline, settings, status: 'queued', progress: 0, file: null, error: null };
    this.items = [...this.items, job];
    this.changed();
    return job;
  }

  addOutputs(timelines: readonly string[], presets: readonly string[]): RenderJob[] {
    return timelines.flatMap((timeline) => presets.map((preset) => this.add({ timeline, preset })));
  }

  remove(id: string): void {
    const job = this.items.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'rendering') throw new Error('Cancel the render before removing it');
    this.items = this.items.filter((j) => j !== job);
    this.changed();
  }

  clearFinished(): void {
    this.items = this.items.filter((j) => j.status === 'queued' || j.status === 'rendering');
    this.changed();
  }

  retry(id: string): void {
    const job = this.items.find((j) => j.id === id);
    if (!job || job.status === 'queued' || job.status === 'rendering') return;
    Object.assign(job, { status: 'queued', progress: 0, file: null, error: null });
    this.changed();
  }

  start(): Promise<void> {
    this.stopped = false;
    this.running ??= this.loop().finally(() => {
      this.running = null;
      this.changed();
    });
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    if (this.signal) this.signal.canceled = true;
  }

  private async loop(): Promise<void> {
    let first = !this.items.some((j) => j.status === 'done');
    for (let job = this.next(); job && !this.stopped; job = this.next()) {
      const signal = { canceled: false };
      this.signal = signal;
      job.status = 'rendering';
      this.changed();
      try {
        job.file = await this.session.renderTo(job.settings, { kind: 'storage', name: job.name, folder: FOLDER, clear: first }, (fraction) => {
          job.progress = fraction;
          this.changed();
        }, signal);
        job.status = 'done';
        job.progress = 1;
        first = false;
        this.session.log.record('info', 'export', `Rendered ${job.name}`);
      } catch (e) {
        job.status = signal.canceled ? 'canceled' : 'failed';
        job.error = signal.canceled ? null : (e as Error).message;
      }
      this.signal = null;
      this.changed();
    }
  }

  private next(): RenderJob | undefined {
    return this.items.find((j) => j.status === 'queued');
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.items.map((j) => j.name));
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf('.');
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, dot)} ${i}${name.slice(dot)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private changed(): void {
    this.emit('change', this.items);
  }
}
