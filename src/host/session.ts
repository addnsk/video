import { Emitter } from '../core/emitter';
import { EventLog } from '../core/log';
import { createId } from '../core/ids';
import type { AssetMeta } from '../core/model';
import { addAsset, addTrack, insertItem, sequence } from '../core/operations';
import { placeTrack } from '../core/timeline';
import { Store } from '../core/store';
import { registerBuiltins } from '../effects/builtin';
import { EffectRegistry } from '../effects/registry';
import type { ExportSettings } from '../engine/export/exporter';
import { exportExtension, exportMimeType } from '../engine/export/formats';
import type { EngineEvents, ExportTarget } from '../engine/protocol';
import type { EngineClient } from './engine-client';
import type { PickedFile } from './file-picker';
import { AssetDataCache } from './asset-data';
import { localLogStore } from './log-store';
import { detectPlatform } from './platform';
import type { PlatformReport } from './platform-report';
import { LutLibrary } from './luts';
import { TemplateLibrary } from './template-library';
import { StillsController } from './stills';
import { SourceMonitor, TimelineMarks } from './source-monitor';
import { Transport } from './transport';

export type ProxyState = EngineEvents['proxy']['state'];

export interface SessionEvents extends Record<string, unknown> {
  proxy: { assetId: string; state: ProxyState; fraction: number };
  media: { missing: readonly string[] };
  imported: { meta: AssetMeta; file: File; handle?: FileSystemFileHandle };
  peaks: string;
  thumbnails: string;
  view: { itemId: string; nodeId: string } | null;
  error: string;
}

export interface ThumbnailStrip {
  readonly start: number;
  readonly interval: number;
  readonly frames: readonly (ImageBitmap | null)[];
}

const THUMBNAIL_HEIGHT = 96;
const MAX_THUMBNAILS = 60;

export interface ExportResult {
  readonly file: File | null;
  readonly name: string;
  readonly savedToDisk: boolean;
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

export class EditorSession extends Emitter<SessionEvents> {
  readonly store = new Store();
  readonly registry = new EffectRegistry();
  readonly luts = new LutLibrary();
  readonly transport: Transport;
  readonly source: SourceMonitor;
  readonly marks = new TimelineMarks();
  readonly files = new Map<string, File>();
  readonly proxies = new Map<string, { state: ProxyState; fraction: number }>();
  readonly log = new EventLog(200, localLogStore('montage.log'));
  readonly templates = new TemplateLibrary();
  readonly stills = new StillsController(this);
  private peakData: AssetDataCache<Float32Array>;
  private platformReport: Promise<PlatformReport> | null = null;
  private thumbnailData: AssetDataCache<ThumbnailStrip>;
  private exportProgress = new Map<string, (fraction: number) => void>();

  constructor(readonly engine: EngineClient) {
    super();
    registerBuiltins(this.registry);
    this.peakData = new AssetDataCache<Float32Array>(
      {
        available: (id) => this.files.has(id) && !!this.store.project.assets[id]?.hasAudio,
        load: async (id) => (await this.engine.remote.peaks(id)) as Float32Array,
      },
      (id) => this.emit('peaks', id),
    );
    this.thumbnailData = new AssetDataCache<ThumbnailStrip>(
      {
        available: (id) => this.files.has(id) && !!this.store.project.assets[id]?.hasVideo,
        load: (id) => this.loadThumbnails(id),
        dispose: (strip) => strip.frames.forEach((f) => f?.close()),
      },
      (id) => this.emit('thumbnails', id),
      this.engine.budget.deviceClass === 'desktop' ? 48 : 12,
    );
    this.transport = new Transport(engine, this.store);
    this.source = new SourceMonitor(engine, this.store, this.transport);
    this.store.on('change', ({ project }) => void engine.remote.setProject(project));
    this.registry.on('change', (def) => void engine.remote.setEffects([def]));
    this.luts.on('added', (entry) => void engine.remote.setLut(entry.id, entry.lut));
    this.luts.on('removed', (id) => void engine.remote.setLut(id, null));
    engine.events.on('error', ({ message, stack }) => {
      this.log.record('error', 'engine', message, stack);
      this.emit('error', message);
    });
    engine.events.on('memory', ({ level, bytes, limit }) => {
      const mb = (n: number) => Math.round(n / 1048576);
      this.log.record(level === 'normal' ? 'info' : 'warning', 'engine', `Memory ${level}: ${mb(bytes)} of ${mb(limit)} MB`);
    });
    engine.events.on('proxy', ({ assetId, state, message }) => {
      this.proxies.set(assetId, { state, fraction: state === 'ready' ? 1 : 0 });
      this.emit('proxy', { assetId, state, fraction: state === 'ready' ? 1 : 0 });
      if (state === 'failed' && message) {
        this.log.record('error', 'media', `Proxy for ${this.store.project.assets[assetId]?.name ?? assetId}: ${message}`);
        this.emit('error', message);
      }
    });
    engine.events.on('progress', ({ task, id, fraction }) => {
      if (task === 'export') this.exportProgress.get(id)?.(fraction);
      else {
        const entry = { state: 'building' as ProxyState, fraction };
        this.proxies.set(id, entry);
        this.emit('proxy', { assetId: id, ...entry });
      }
    });
  }

  get videoTrackId(): string {
    return this.store.project.tracks.find((t) => t.kind === 'video' && t.magnetic)!.id;
  }

  async importFile(file: File, handle?: FileSystemFileHandle): Promise<AssetMeta> {
    const meta = await this.engine.remote.probe(createId('asset'), file);
    this.files.set(meta.id, file);
    this.store.dispatch(addAsset(meta), { history: false });
    this.emit('imported', { meta, file, handle });
    return meta;
  }

  attachFile(meta: AssetMeta, file: File): void {
    this.files.set(meta.id, file);
    void this.engine.remote.attach(meta, file);
    this.emit('media', { missing: this.missing });
    void this.engine.remote.renderStill(this.transport.time, this.transport.bypass);
  }

  get missing(): string[] {
    return Object.keys(this.store.project.assets).filter((id) => !this.files.has(id));
  }

  async importAndPlace(picked: Iterable<PickedFile>, onError: (file: File, error: Error) => void): Promise<AssetMeta[]> {
    const added: AssetMeta[] = [];
    for (const { file, handle } of picked) {
      try {
        const meta = await this.importFile(file, handle);
        this.store.dispatch(this.placement(meta));
        added.push(meta);
      } catch (e) {
        this.log.record('error', 'media', `${file.name}: ${(e as Error).message}`, (e as Error).stack);
        onError(file, e as Error);
      }
    }
    return added;
  }

  private placement(meta: AssetMeta) {
    if (meta.hasVideo) return insertItem(meta.id, { trackId: this.videoTrackId });
    const audio = this.store.project.tracks.find((t) => t.kind === 'audio');
    const trackId = audio?.id ?? 'a1';
    const end = audio ? placeTrack(audio).reduce((m, p) => Math.max(m, p.end), 0) : 0;
    return sequence(...(audio ? [] : [addTrack('audio', trackId)]), insertItem(meta.id, { trackId, start: end }));
  }

  async exportVideo(settings: ExportSettings, onProgress: (fraction: number) => void, signal: { canceled: boolean }): Promise<ExportResult> {
    const extension = exportExtension(settings);
    const name = `export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    let target: ExportTarget = { kind: 'storage', name };
    if (picker && this.engine.mode === 'worker') {
      try {
        const handle = await picker({ suggestedName: name, types: [{ description: `${extension.toUpperCase()} video`, accept: { [exportMimeType(settings)]: [`.${extension}`] } }] });
        target = { kind: 'handle', handle };
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
      }
    }
    const id = createId('export');
    this.exportProgress.set(id, onProgress);
    const poll = setInterval(() => signal.canceled && void this.engine.remote.cancel(id), 200);
    try {
      const file = await this.engine.remote.exportVideo(id, settings, target);
      this.log.record('info', 'export', `Exported ${name}${settings.prores ? ` (ProRes ${settings.prores})` : ''}`);
      return { file, name, savedToDisk: target.kind === 'handle' };
    } catch (e) {
      if (!signal.canceled) this.log.error('export', e);
      throw e;
    } finally {
      clearInterval(poll);
      this.exportProgress.delete(id);
    }
  }

  peaks(assetId: string): Float32Array | null {
    return this.peakData.get(assetId);
  }

  thumbnails(assetId: string): ThumbnailStrip | null {
    return this.thumbnailData.get(assetId);
  }

  private async loadThumbnails(assetId: string): Promise<ThumbnailStrip> {
    const meta = this.store.project.assets[assetId];
    const duration = meta.end - meta.start;
    const count = Math.max(1, Math.min(MAX_THUMBNAILS, Math.ceil(duration)));
    const interval = duration / count;
    const times = Array.from({ length: count }, (_, i) => meta.start + (i + 0.5) * interval);
    const frames = (await this.engine.remote.thumbnails(assetId, times, THUMBNAIL_HEIGHT)) as (ImageBitmap | null)[];
    return { start: meta.start, interval, frames };
  }

  viewedNode: { itemId: string; nodeId: string } | null = null;

  viewNode(target: { itemId: string; nodeId: string } | null): void {
    this.viewedNode = target;
    void this.engine.remote.setViewNode(target);
    this.emit('view', target);
  }

  platform(): Promise<PlatformReport> {
    this.platformReport ??= Promise.all([detectPlatform(), this.engine.remote.capabilities()]).then(([host, engine]) => ({ host, engine, engineMode: this.engine.mode }));
    return this.platformReport;
  }

  requestProxy(assetId: string): void {
    void this.engine.remote.ensureProxy(assetId, true);
  }
}
