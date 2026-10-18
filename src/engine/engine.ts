import { registerProresDecoder } from '@mediabunny/prores';
import { serializeSharedProresDecoding } from './media/prores-guard';
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
import { Compositor, type ViewNode } from './gpu/compositor';
import { MediaPool } from './media/media-pool';
import { probe } from './media/probe';
import { buildProxy, findProxy } from './media/proxy';
import type { ClockAnchor, EngineEvents, EngineInit, EngineMethods, EngineStats, ExportTarget } from './protocol';
import { gpuCapabilities, probeCodecs, type EngineCapabilities } from './capabilities';
import { MemoryGovernor } from './memory';
import { metrics } from './metrics';
import { resources } from './resources';
import { analyze } from './scopes';
import { TextRenderer } from './text';
import { TextRasterizer } from './text-raster';
import { loadFonts } from './fonts';
import { computePeaks } from './audio/peaks';
import { decodeThumbnails } from './media/thumbnails';
import { frameKey } from './render-cache/frame-key';
import { opfsFrameStore } from './render-cache/frame-store';
import { RenderCache } from './render-cache/render-cache';
import { trackMedia, type MediaTrackOptions, type TrackSample } from './tracking/track-media';

const SCOPE_INTERVAL_MS = 120;
const HEAVY_FRAME_SHARE = 0.5;
const HEAVY_FRAME_PASSES = 8;

serializeSharedProresDecoding();
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
  private textRaster = new TextRasterizer();
  private renderCache!: RenderCache;
  private renderGeneration = 0;
  renderCacheEnabled = true;
  private peakCache = new Map<string, Promise<Float32Array>>();
  private governor!: MemoryGovernor;
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
    this.governor = new MemoryGovernor(this.budget.memoryLimitBytes, () => resources.total());
    this.renderCache = new RenderCache({ memoryBytes: this.budget.renderCacheBytes, diskBytes: this.budget.renderDiskBytes });
    void opfsFrameStore().then((store) => this.renderCache.attach(store));
    this.governor.register({ name: 'renderCache', bytes: () => this.renderCache.bytes, trim: (keep) => this.renderCache.trim(keep) });
    this.governor.register({ name: 'stillCache', bytes: () => this.stills.cachedBytes, trim: (keep) => this.stills.trim(keep) });
    this.governor.register({ name: 'nodeCache', bytes: () => this.compositor?.nodeCacheBytes ?? 0, trim: () => this.compositor?.trimNodeCache() });
    this.governor.register({ name: 'idleTargets', bytes: () => this.compositor?.idleTargetBytes ?? 0, trim: () => this.compositor?.trimIdle() });
    this.governor.on('pressure', ({ level, bytes, limit }) => {
      this.stills.previewScale = this.governor.previewScale;
      metrics.count(`memory.${level}`);
      this.emit('memory', { level, bytes, limit });
    });
    void loadFonts(fonts).then(() => {
      this.text.clear();
      this.textRaster.clear();
      this.compositor?.trimNodeCache();
      this.invalidateRenders();
      this.redraw();
    });
    this.gpu = new GpuContext(surface);
    this.compositor = new Compositor(this.gpu, this.registry, { lut: (id) => this.luts.get(id) });
    this.compositor.setProject(this.project);
    this.compositor.registerRasterizer('text', this.textRaster);
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
    this.compositor?.setProject(project);
    this.redraw();
  }

  setEffects(defs: EffectDef[]): void {
    for (const def of defs) this.registry.register(def);
    this.invalidateRenders();
    this.redraw();
  }

  setLut(id: string, lut: Lut3D | null): void {
    this.invalidateRenders();
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

  async track(assetId: string, times: number[], start: { x: number; y: number }, options: MediaTrackOptions): Promise<TrackSample[]> {
    const run = this.thumbnailQueue.then(() => trackMedia(this.pool.acquire(assetId, 'master'), times, start, options));
    this.thumbnailQueue = run.catch(() => undefined);
    return run;
  }

  private viewNode: ViewNode | null = null;

  setViewNode(target: ViewNode | null): void {
    this.viewNode = target;
    this.redraw();
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
      memory: this.governor?.report() ?? null,
      renderCache: this.renderCache ? { bytes: this.renderCache.bytes, diskBytes: this.renderCache.diskUsage, ...this.renderCache.entries } : null,
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    return {
      gpu: this.gpu ? gpuCapabilities(this.gpu.gl, this.gpu.floatTargets) : null,
      codecs: await probeCodecs(),
      workers: typeof Worker !== 'undefined',
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

  private invalidateRenders() {
    this.renderGeneration++;
    this.renderCache?.clear();
  }

  setRenderCache(options: { enabled?: boolean; memoryBytes?: number; diskBytes?: number }): void {
    if (options.enabled !== undefined) this.renderCacheEnabled = options.enabled;
    if (!this.renderCacheEnabled) this.renderCache.clear();
    const { memoryBytes, diskBytes } = options;
    this.renderCache.setLimits({ ...(memoryBytes !== undefined ? { memoryBytes } : {}), ...(diskBytes !== undefined ? { diskBytes } : {}) });
  }

  private cacheKey(frame: ReturnType<typeof compositionAt>, bypass: boolean): string | null {
    if (!this.renderCacheEnabled || !this.compositor) return null;
    const surface = this.compositor.surface;
    const spaces = frame.layers.flatMap((l) => [l.base, ...(l.transition ? [l.transition.incoming] : [])]).map(({ placement: { item } }) => (item.kind === 'media' ? (this.project.assets[item.source.assetId]?.colorSpace ?? '') : ''));
    const color = `${this.project.settings?.colorScience ?? 'display'}:${spaces.join(',')}`;
    return frameKey(frame, { width: surface.width, height: surface.height, bypass, viewNode: this.viewNode, generation: this.renderGeneration, color });
  }

  private async presentCached(key: string | null): Promise<boolean> {
    if (!key || !this.compositor) return false;
    const memory = this.renderCache.peek(key);
    if (memory) return this.compositor.present(memory);
    if (!this.renderCache.onDisk(key)) return false;
    const bitmap = await this.renderCache.load(key);
    return !!bitmap && this.compositor.present(bitmap);
  }

  private remember(key: string | null, cost: number) {
    if (!key || !this.compositor) return;
    const interval = 1000 / (this.project.settings?.fps ?? 25);
    if (cost < interval * HEAVY_FRAME_SHARE && this.compositor.passes < HEAVY_FRAME_PASSES) return;
    void this.compositor.snapshot().then(
      (bitmap) => this.renderCache.put(key, bitmap),
      () => metrics.count('renderCache.snapshotFailed'),
    );
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
    const key = this.scopesEnabled ? null : this.cacheKey(frame, request.bypass);
    if (await this.presentCached(key)) {
      metrics.time('still.cached', performance.now() - started);
      return request.done(true);
    }
    const images = await this.stills.load(this.project, frame, this.compositor.size);
    if (!images) {
      metrics.count('still.stale');
      return request.done(false);
    }
    metrics.time('still.load', performance.now() - started);
    const renderStart = performance.now();
    this.compositor.render(frame, images, { bypassFilters: request.bypass, capture: this.captureOption(true), viewNode: this.viewNode });
    metrics.time('still.render', performance.now() - renderStart);
    metrics.time('still.total', performance.now() - started);
    this.remember(key, performance.now() - started);
    this.governor.check();
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
      const key = this.cacheKey(frame, playback.bypass);
      if (await this.presentCached(key)) {
        if (generation !== this.generation) return;
        metrics.time('playback.cached', performance.now() - loadStart);
      } else {
        const images = await playback.frames.load(this.project, frame, this.compositor.size);
        if (generation !== this.generation || !images) return;
        metrics.time('playback.load', performance.now() - loadStart);
        const renderStart = performance.now();
        this.compositor.render(frame, images, { bypassFilters: playback.bypass, capture: this.captureOption(false), viewNode: this.viewNode });
        metrics.time('playback.render', performance.now() - renderStart);
        this.remember(key, performance.now() - loadStart);
      }
      const fps = this.project.settings?.fps ?? 25;
      const index = Math.floor(time * fps);
      if (playback.lastFrame !== null && index > playback.lastFrame + 1) metrics.count('playback.dropped', index - playback.lastFrame - 1);
      if (index !== playback.lastFrame) metrics.count('playback.presented');
      playback.lastFrame = index;
      if (index % 12 === 0) this.governor.check();
      metrics.time('playback.lateness', Math.max(0, (epochNow() - anchor.epochMs) / 1000 * anchor.rate + anchor.time - time) * 1000);
      this.lastStill = { time: Math.min(time, duration), bypass: playback.bypass };
    } finally {
      this.ticking = false;
    }
  }
}
