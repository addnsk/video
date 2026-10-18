import { Emitter } from '../core/emitter';
import { createId } from '../core/ids';
import type { AssetMeta } from '../core/model';
import { addAsset, insertItem, sequence } from '../core/operations';
import { Store } from '../core/store';
import { registerBuiltins } from '../effects/builtin';
import { EffectRegistry } from '../effects/registry';
import type { ExportSettings } from '../engine/export/exporter';
import type { EngineEvents, ExportTarget } from '../engine/protocol';
import type { EngineClient } from './engine-client';
import { LutLibrary } from './luts';
import { Transport } from './transport';

export type ProxyState = EngineEvents['proxy']['state'];

export interface SessionEvents extends Record<string, unknown> {
  proxy: { assetId: string; state: ProxyState; fraction: number };
  error: string;
}

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
  readonly files = new Map<string, File>();
  readonly proxies = new Map<string, { state: ProxyState; fraction: number }>();
  private exportProgress = new Map<string, (fraction: number) => void>();

  constructor(readonly engine: EngineClient) {
    super();
    registerBuiltins(this.registry);
    this.transport = new Transport(engine, this.store);
    this.store.on('change', ({ project }) => void engine.remote.setProject(project));
    this.registry.on('change', (def) => void engine.remote.setEffects([def]));
    this.luts.on('added', (entry) => void engine.remote.setLut(entry.id, entry.lut));
    this.luts.on('removed', (id) => void engine.remote.setLut(id, null));
    engine.events.on('error', ({ message }) => this.emit('error', message));
    engine.events.on('proxy', ({ assetId, state, message }) => {
      this.proxies.set(assetId, { state, fraction: state === 'ready' ? 1 : 0 });
      this.emit('proxy', { assetId, state, fraction: state === 'ready' ? 1 : 0 });
      if (state === 'failed' && message) this.emit('error', message);
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

  async importFile(file: File): Promise<AssetMeta> {
    const meta = await this.engine.remote.probe(createId('asset'), file);
    this.files.set(meta.id, file);
    this.store.dispatch(addAsset(meta), { history: false });
    return meta;
  }

  async importAndPlace(files: Iterable<File>, onError: (file: File, error: Error) => void): Promise<AssetMeta[]> {
    const added: AssetMeta[] = [];
    for (const file of files) {
      try {
        const meta = await this.importFile(file);
        this.store.dispatch(sequence(insertItem(meta.id, { trackId: this.videoTrackId })));
        added.push(meta);
      } catch (e) {
        onError(file, e as Error);
      }
    }
    return added;
  }

  async exportVideo(settings: ExportSettings, onProgress: (fraction: number) => void, signal: { canceled: boolean }): Promise<ExportResult> {
    const name = `export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    let target: ExportTarget = { kind: 'storage', name };
    if (picker && this.engine.mode === 'worker') {
      try {
        const handle = await picker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
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
      return { file, name, savedToDisk: target.kind === 'handle' };
    } finally {
      clearInterval(poll);
      this.exportProgress.delete(id);
    }
  }

  requestProxy(assetId: string): void {
    void this.engine.remote.ensureProxy(assetId, true);
  }
}
