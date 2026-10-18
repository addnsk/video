import { registerProresDecoder } from '@mediabunny/prores';
import { Emitter } from '../core/emitter';
import type { AssetMeta, Project } from '../core/model';
import { emptyProject } from '../core/model';
import { transfer } from '../core/rpc';
import { compositionAt, projectDuration } from '../core/timeline';
import { registerBuiltins } from '../effects/builtin';
import type { Lut3D } from '../effects/cube';
import { EffectRegistry } from '../effects/registry';
import type { EffectDef } from '../effects/types';
import { AudioMixer } from './audio/mixer';
import { budgetFor, type MemoryBudget } from './device';
import { ExportCanceled, exportProject, type ExportSettings } from './export/exporter';
import { fileHandleSink, storageSink } from './export/sinks';
import { SequentialFrames, StillFrames } from './frames';
import { GpuContext } from './gpu/context';
import { Compositor } from './gpu/compositor';
import { MediaPool } from './media/media-pool';
import { probe } from './media/probe';
import { buildProxy, findProxy } from './media/proxy';
import type { ClockAnchor, EngineEvents, EngineInit, EngineMethods, EngineStats, ExportTarget } from './protocol';
import { metrics } from './metrics';
import { resources } from './resources';
import { analyze } from './scopes';
import { TextRenderer } from './text';
import { loadFonts } from './fonts';
import { computePeaks } from './audio/peaks';
import { decodeThumbnails } from './media/thumbnails';

const SCOPE_INTERVAL_MS = 120;

registerProresDecoder();

const nextTick: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);

const epochNow = () => performance.timeOrigin + performance.now();

class Coalescer<T> {
  private pending: T | null = null;
  private running = false;

  constructor(private run: (value: T) => Promise<void>) {}

  push(value: T): void {
    this.pending = value;
    if (!this.running) void this.drain();
  }

  get latest(): T | null {
    return this.pending;
  }

  private async drain() {
    this.running = true;
    while (this.pending !== null) {
      const value = this.pending;
      this.pending = null;
      await this.run(value).catch(() => undefined);
    }
    this.running = false;
  }
}

export class Engine extends Emitter<EngineEvents> implements EngineMethods {
  private budget!: MemoryBudget;
  private registry = new EffectRegistry();
  private luts = new Map<string, Lut3D>();
  private pool!: MediaPool;
  private mixer!: AudioMixer;
  private stills!: StillFrames;
  private text = new TextRenderer();
  private peakCache = new Map<string, Promise<Float32Array>>();
  private thumbnailQueue: Promise<unknown> = Promise.resolve();
  private gpu: GpuContext | null = null;
  private compositor: Compositor | null = null;
  private project: Project = emptyProject();
  private lastStill = { time: 0, bypass: false };
  private playback: { anchor: ClockAnchor; bypass: boolean; frames: SequentialFrames; generation: number; lastFrame: number | null } | null = null;
  private generation = 0;
  private canceled = new Set<string>();
  private proxyQueue: string[] = [];
  private proxyRunning = false;
  private scopesEnabled = false;
  private lastScope = 0;
  private stillQueue = new Coalescer<{ time: number; bypass: boolean; done: (ok: boolean) => void }>((r) => this.drawStill(r));

  constructor() {
    super();
    registerBuiltins(this.registry);
  }

  async init({ surface, device, fonts }: EngineInit): Promise<MemoryBudget> {
    this.budget = budgetFor(device);
    this.pool = new MediaPool(this.budget);
    this.mixer = new AudioMixer(this.pool);
    this.stills = new StillFrames(this.pool, this.text, this.budget);
    this.stills.isStale = () => this.stillQueue.latest !== null || !!this.playback;
    void loadFonts(fonts).then(() => {
      this.text.clear();
      this.redraw();
    });
    this.gpu = new GpuContext(surface);
    this.compositor = new Compositor(this.gpu, this.registry, { lut: (id) => this.luts.get(id) });
    this.compositor.onError = (message) => this.emit('error', { message });
    this.gpu.on('lost', () => this.emit('context', { state: 'lost' }));
    this.gpu.on('restored', () => {
      this.emit('context', { state: 'restored' });
      this.redraw();
    });
    return this.budget;
  }

  resize(width: number, height: number): void {
    if (!this.gpu) return;
    const surface = this.gpu.surface;
    if (surface.width === width && surface.height === height) return;
    surface.width = width;
    surface.height = height;
    this.redraw();
  }

  setProject(project: Project): void {
    this.project = project;
    this.redraw();
  }

  setEffects(defs: EffectDef[]): void {
    for (const def of defs) this.registry.register(def);
    this.redraw();
  }

  setLut(id: string, lut: Lut3D | null): void {
    if (lut) this.luts.set(id, lut);
    else {
      this.luts.delete(id);
      this.compositor?.releaseLut(id);
    }
    this.redraw();
  }

  async probe(assetId: string, file: File): Promise<AssetMeta> {
    const meta = await probe(file, assetId);
    this.attach(meta, file);
    return meta;
  }

  attach(meta: AssetMeta, file: File): void {
    this.pool.register(meta, file);
    void this.restoreProxy(meta);
  }

  renderStill(time: number, bypassFilters: boolean): Promise<boolean> {
    this.lastStill = { time, bypass: bypassFilters };
    if (this.playback) return Promise.resolve(false);
    return new Promise((done) => this.stillQueue.push({ time, bypass: bypassFilters, done }));
  }

  play(anchor: ClockAnchor, bypassFilters: boolean): void {
    this.stop();
    const generation = ++this.generation;
    this.playback = { anchor, bypass: bypassFilters, frames: new SequentialFrames(this.pool, this.text, 'preview'), generation, lastFrame: null };
    this.loop(generation, false);
  }

  stop(): void {
    if (!this.playback) return;
    this.playback.frames.close();
    this.playback = null;
    this.generation++;
  }

  async mixAudio(t0: number, t1: number, rate: number) {
    const planar = await this.mixer.mix(this.project, t0, t1, rate);
    return transfer(planar, planar.map((c) => c.buffer));
  }

  async exportVideo(id: string, settings: ExportSettings, target: ExportTarget): Promise<File | null> {
    const sink = target.kind === 'handle' ? await fileHandleSink(target.handle) : await storageSink(target.name);
    try {
      await exportProject(
        this.project,
        settings,
        sink,
        { pool: this.pool, registry: this.registry, luts: { lut: (lid) => this.luts.get(lid) }, budget: this.budget, text: this.text },
        (fraction) => this.emit('progress', { task: 'export', id, fraction }),
        () => this.canceled.has(id),
      );
      return await sink.finish();
    } catch (e) {
      if (e instanceof ExportCanceled) throw new Error('Export canceled');
      throw e;
    } finally {
      this.canceled.delete(id);
    }
  }

  cancel(id: string): void {
    this.canceled.add(id);
  }

  ensureProxy(assetId: string, force: boolean): void {
    const meta = this.pool.meta(assetId);
    if (!meta || this.pool.hasProxy(assetId) || this.proxyQueue.includes(assetId)) return;
    if (!force && !this.needsProxy(meta)) return;
    this.proxyQueue.push(assetId);
    this.emit('proxy', { assetId, state: 'queued' });
    void this.runProxies();
  }

  async peaks(assetId: string): Promise<unknown> {
    let pending = this.peakCache.get(assetId);
    if (!pending) {
      pending = computePeaks(this.pool.acquire(assetId, 'master'));
      this.peakCache.set(assetId, pending);
    }
    const peaks = await pending;
    return peaks.slice();
  }

  async thumbnails(assetId: string, times: number[], height: number) {
    const run = this.thumbnailQueue.then(() => decodeThumbnails(this.pool.acquire(assetId, 'preview'), times, height));
    this.thumbnailQueue = run.catch(() => undefined);
    const bitmaps = await run;
    return transfer(bitmaps, bitmaps.filter((b): b is ImageBitmap => !!b));
  }

  setScopes(enabled: boolean): void {
    this.scopesEnabled = enabled;
    this.lastScope = 0;
    if (enabled) this.redraw();
  }

  private captureOption(force: boolean) {
    if (!this.scopesEnabled) return undefined;
    const now = performance.now();
    if (!force && now - this.lastScope < SCOPE_INTERVAL_MS) return undefined;
    this.lastScope = now;
    return (pixels: Uint8Array, width: number, height: number) => {
      const data = analyze(pixels, width, height);
      this.emit('scopes', transfer(data, [data.waveform.buffer, data.vector.buffer, data.histogram.buffer]) as never);
    };
  }

  stats(): EngineStats {
    return {
      budget: this.budget,
      resources: resources.snapshot(),
      frameCacheBytes: this.stills?.cachedBytes ?? 0,
      floatTargets: this.gpu?.floatTargets ?? false,
      metrics: metrics.snapshot(),
    };
  }

  resetMetrics(): void {
    metrics.reset();
  }

  private needsProxy(meta: AssetMeta): boolean {
    if (meta.height > this.budget.proxyThresholdHeight) return true;
    return meta.codec === 'ProRes' && this.budget.deviceClass !== 'desktop';
  }

  private async restoreProxy(meta: AssetMeta) {
    const existing = await findProxy(meta, this.budget.proxyHeight).catch(() => null);
    if (existing) {
      this.pool.setProxy(meta.id, existing.file, existing.offset);
      this.stills.close();
      this.emit('proxy', { assetId: meta.id, state: 'ready' });
      this.redraw();
      return;
    }
    this.ensureProxy(meta.id, false);
  }

  private async runProxies() {
    if (this.proxyRunning) return;
    this.proxyRunning = true;
    while (this.proxyQueue.length) {
      const assetId = this.proxyQueue[0];
      const meta = this.pool.meta(assetId)!;
      const original = this.pool.original(assetId)!;
      this.emit('proxy', { assetId, state: 'building' });
      try {
        const result = await buildProxy(
          original,
          meta,
          this.budget.proxyHeight,
          (fraction) => this.emit('progress', { task: 'proxy', id: assetId, fraction }),
          () => this.canceled.has(assetId),
        );
        this.pool.setProxy(assetId, result.file, result.offset);
        this.stills.close();
        this.emit('proxy', { assetId, state: 'ready' });
        this.redraw();
      } catch (e) {
        this.emit('proxy', { assetId, state: 'failed', message: (e as Error).message });
      } finally {
        this.canceled.delete(assetId);
        this.proxyQueue.shift();
      }
    }
    this.proxyRunning = false;
  }

  private redraw() {
    if (this.playback || !this.compositor) return;
    void this.renderStill(this.lastStill.time, this.lastStill.bypass);
  }

  private async drawStill(request: { time: number; bypass: boolean; done: (ok: boolean) => void }) {
    if (!this.compositor || this.playback) return request.done(false);
    const time = Math.min(request.time, Math.max(0, projectDuration(this.project) - 1e-3));
    const frame = compositionAt(this.project, time);
    const started = performance.now();
    const images = await this.stills.load(this.project, frame, this.compositor.size);
    if (!images) {
      metrics.count('still.stale');
      return request.done(false);
    }
    metrics.time('still.load', performance.now() - started);
    const renderStart = performance.now();
    this.compositor.render(frame, images, { bypassFilters: request.bypass, capture: this.captureOption(true) });
    metrics.time('still.render', performance.now() - renderStart);
    metrics.time('still.total', performance.now() - started);
    request.done(true);
  }

  private loop(generation: number, busy: boolean) {
    if (generation !== this.generation || !this.playback) return;
    if (!busy) void this.tick(generation);
    nextTick(() => this.loop(generation, this.ticking));
  }

  private ticking = false;

  private async tick(generation: number) {
    const playback = this.playback;
    if (!playback || !this.compositor) return;
    this.ticking = true;
    try {
      const { anchor } = playback;
      const time = anchor.time + ((epochNow() - anchor.epochMs) / 1000) * anchor.rate;
      const duration = projectDuration(this.project);
      if (time < anchor.time) return;
      const frame = compositionAt(this.project, Math.min(time, Math.max(0, duration - 1e-3)));
      const loadStart = performance.now();
      const images = await playback.frames.load(this.project, frame, this.compositor.size);
      if (generation !== this.generation || !images) return;
      metrics.time('playback.load', performance.now() - loadStart);
      const renderStart = performance.now();
      this.compositor.render(frame, images, { bypassFilters: playback.bypass, capture: this.captureOption(false) });
      metrics.time('playback.render', performance.now() - renderStart);
      const fps = this.project.settings?.fps ?? 25;
      const index = Math.floor(time * fps);
      if (playback.lastFrame !== null && index > playback.lastFrame + 1) metrics.count('playback.dropped', index - playback.lastFrame - 1);
      if (index !== playback.lastFrame) metrics.count('playback.presented');
      playback.lastFrame = index;
      metrics.time('playback.lateness', Math.max(0, (epochNow() - anchor.epochMs) / 1000 * anchor.rate + anchor.time - time) * 1000);
      this.lastStill = { time: Math.min(time, duration), bypass: playback.bypass };
    } finally {
      this.ticking = false;
    }
  }
}
