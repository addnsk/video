import { Emitter } from '../../core/emitter';
import type { AssetMeta } from '../../core/model';
import { BUILTIN_EFFECTS } from '../../effects/builtin';
import type { EditorSession } from '../session';
import { migrateProject } from '../../core/migrate';
import { Database } from './database';
import { isProjectDocument, type ProjectDocument } from './document';

type PermissionCapable = FileSystemFileHandle & {
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
};

interface DocumentRecord {
  id: string;
  document: ProjectDocument;
}

interface HandleRecord {
  assetId: string;
  handle: FileSystemFileHandle;
}

const CURRENT = 'current';
const AUTOSAVE_DELAY_MS = 800;
const BUILTIN_IDS = new Set(BUILTIN_EFFECTS.map((d) => d.id));

export interface PersistenceEvents extends Record<string, unknown> {
  saved: Date;
  restored: { missing: readonly string[] };
}

export class ProjectPersistence extends Emitter<PersistenceEvents> {
  private db = new Database('montage', 1, [
    { name: 'documents', keyPath: 'id' },
    { name: 'handles', keyPath: 'assetId' },
  ]);
  private timer = 0;
  private restoring = false;

  constructor(private session: EditorSession) {
    super();
    const schedule = () => this.schedule();
    session.store.on('change', schedule);
    session.luts.on('added', schedule);
    session.luts.on('removed', schedule);
    session.registry.on('change', schedule);
    session.on('imported', ({ meta, handle }) => handle && void this.rememberHandle(meta.id, handle));
  }

  serialize(): Blob {
    const doc = this.snapshot();
    const plain = { ...doc, luts: doc.luts.map((l) => ({ ...l, data: Array.from(l.data) })) };
    return new Blob([JSON.stringify(plain)], { type: 'application/json' });
  }

  async open(file: File): Promise<void> {
    const parsed: unknown = JSON.parse(await file.text());
    if (!isProjectDocument(parsed)) throw new Error(`"${file.name}" is not a Montage project`);
    await this.load(parsed);
    await this.reconnect(false);
    await this.save();
  }

  snapshot(): ProjectDocument {
    const { store, luts, registry } = this.session;
    const used = new Set<string>();
    for (const track of store.project.tracks)
      for (const item of track.items) for (const e of item.effects) if (typeof e.params.table === 'string') used.add(e.params.table);
    return {
      format: 'montage-project',
      version: 1,
      savedAt: new Date().toISOString(),
      project: store.project,
      luts: luts
        .all()
        .filter((l) => used.has(l.id))
        .map((l) => ({ id: l.id, name: l.name, size: l.lut.size, data: l.lut.data })),
      effects: registry.all().filter((d) => !BUILTIN_IDS.has(d.id)),
    };
  }

  async rememberHandle(assetId: string, handle: FileSystemFileHandle): Promise<void> {
    await this.db.put<HandleRecord>('handles', { assetId, handle }).catch(() => undefined);
  }

  async restore(): Promise<boolean> {
    const record = await this.db.get<DocumentRecord>('documents', CURRENT).catch(() => undefined);
    if (!record || !isProjectDocument(record.document)) return false;
    await this.load(record.document);
    await this.reconnect(false);
    this.emit('restored', { missing: this.session.missing });
    return true;
  }

  async load(document: ProjectDocument): Promise<void> {
    this.restoring = true;
    try {
      const { session } = this;
      for (const def of document.effects) session.registry.register(def);
      for (const lut of document.luts) session.luts.add(lut.name, { size: lut.size, data: Float32Array.from(lut.data) }, lut.id);
      const known = [...session.files.values()].filter((f): f is File => f instanceof File);
      session.files.clear();
      session.store.reset(migrateProject(document.project));
      this.relink(known);
    } finally {
      this.restoring = false;
    }
    this.session.emit('media', { missing: this.session.missing });
  }

  async reconnect(prompt: boolean): Promise<number> {
    let attached = 0;
    for (const assetId of this.session.missing) {
      const record = await this.db.get<HandleRecord>('handles', assetId).catch(() => undefined);
      const handle = record?.handle as PermissionCapable | undefined;
      if (!handle?.queryPermission) continue;
      let state = await handle.queryPermission({ mode: 'read' });
      if (state === 'prompt' && prompt) state = await handle.requestPermission({ mode: 'read' });
      if (state !== 'granted') continue;
      const file = await handle.getFile().catch(() => null);
      const meta = this.session.store.project.assets[assetId];
      if (file && meta && matches(meta, file)) {
        this.session.attachFile(meta, file);
        attached++;
      }
    }
    return attached;
  }

  relink(files: Iterable<File>): number {
    let attached = 0;
    const pool = [...files];
    for (const assetId of this.session.missing) {
      const meta = this.session.store.project.assets[assetId];
      if (meta.placeholder) {
        const file = pool.find((f) => f.name.toLowerCase() === meta.name.toLowerCase());
        if (!file) continue;
        void this.session.resolvePlaceholder(meta, file).catch((e) => this.session.log.error('media', e));
        attached++;
        continue;
      }
      const file = pool.find((f) => matches(meta, f)) ?? pool.find((f) => f.name === meta.name && f.size === meta.size);
      if (!file) continue;
      this.session.attachFile(meta, file);
      attached++;
    }
    return attached;
  }

  async discard(): Promise<void> {
    await this.db.delete('documents', CURRENT).catch(() => undefined);
  }

  private schedule() {
    if (this.restoring) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  private async save() {
    await this.db.put<DocumentRecord>('documents', { id: CURRENT, document: this.snapshot() });
    this.emit('saved', new Date());
  }
}

const matches = (meta: AssetMeta, file: File) =>
  file.name === meta.name && file.size === meta.size && (!meta.lastModified || file.lastModified === meta.lastModified);
