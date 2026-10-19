import { Emitter } from '../../core/emitter';
import type { AssetMeta } from '../../core/model';
import { addAsset } from '../../core/operations';
import type { RemoteMedia } from '../../engine/media/media-input';
import type { ProjectPersistence } from '../persistence/project-persistence';
import type { EditorSession } from '../session';
import { S3Client, type S3Config, type S3Object } from './s3';

const PROJECTS = 'projects/';
const MEDIA = 'media/';
const PROJECT_SUFFIX = '.montage.json';
const SETTINGS_KEY = 'montage.remote';
const URL_LIFETIME = 7 * 24 * 3600;

export interface RemoteEvents extends Record<string, unknown> {
  state: { connected: boolean; bucket: string | null };
  progress: { task: 'upload'; name: string; fraction: number };
}

export interface RemoteProject {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface RemoteFile {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly inProject: boolean;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'untitled';

const MEDIA_EXTENSIONS = /\.(mov|mp4|m4v|mkv|webm|mxf|wav|mp3|m4a|aac|flac|ogg|opus)$/i;

function storage(remember: boolean): Storage | null {
  try {
    return remember ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

export class RemoteStorage extends Emitter<RemoteEvents> {
  private client: S3Client | null = null;
  private attaching = false;

  constructor(
    private session: EditorSession,
    private persistence: ProjectPersistence,
  ) {
    super();
    session.on('media', ({ missing }) => {
      if (this.client && missing.some((id) => session.store.project.assets[id]?.remote)) void this.attachMissing();
    });
  }

  get connected(): boolean {
    return this.client !== null;
  }

  get config(): Omit<S3Config, 'secretAccessKey' | 'sessionToken'> | null {
    if (!this.client) return null;
    const { secretAccessKey: _s, sessionToken: _t, ...rest } = this.client.config;
    return rest;
  }

  async connect(config: S3Config, remember = false): Promise<void> {
    const client = new S3Client(config);
    await client.list(PROJECTS);
    this.client = client;
    for (const kind of [true, false]) storage(kind)?.removeItem(SETTINGS_KEY);
    storage(remember)?.setItem(SETTINGS_KEY, JSON.stringify(config));
    this.session.log.record('info', 'media', `Connected to bucket ${config.bucket}`);
    this.emit('state', { connected: true, bucket: config.bucket });
    await this.attachMissing();
  }

  async restore(): Promise<boolean> {
    for (const remember of [false, true]) {
      const saved = storage(remember)?.getItem(SETTINGS_KEY);
      if (!saved) continue;
      try {
        await this.connect(JSON.parse(saved) as S3Config, remember);
        return true;
      } catch (e) {
        this.session.log.error('media', e);
      }
    }
    return false;
  }

  disconnect(): void {
    this.client = null;
    for (const kind of [true, false]) storage(kind)?.removeItem(SETTINGS_KEY);
    this.emit('state', { connected: false, bucket: null });
  }

  private require(): S3Client {
    if (!this.client) throw new Error('Connect to a bucket first');
    return this.client;
  }

  async projects(): Promise<RemoteProject[]> {
    const client = this.require();
    const items = await client.list(PROJECTS);
    return items
      .filter((o) => o.key.endsWith(PROJECT_SUFFIX))
      .map((o) => ({ key: o.key, name: o.key.slice(client.key(PROJECTS).length, -PROJECT_SUFFIX.length), size: o.size, lastModified: o.lastModified }))
      .sort((a, b) => b.lastModified - a.lastModified);
  }

  async saveProject(name: string): Promise<string> {
    const client = this.require();
    const key = client.key(`${PROJECTS}${safeName(name)}${PROJECT_SUFFIX}`);
    await client.put(key, this.persistence.serialize(), 'application/json');
    this.session.log.record('info', 'media', `Saved project to ${key}`);
    return key;
  }

  async openProject(key: string): Promise<void> {
    const client = this.require();
    const blob = await client.get(key);
    const name = key.split('/').pop() ?? 'project.json';
    await this.persistence.open(new File([blob], name, { type: 'application/json' }));
    await this.attachMissing();
  }

  async deleteProject(key: string): Promise<void> {
    await this.require().delete(key);
  }

  async media(): Promise<RemoteFile[]> {
    const client = this.require();
    const known = new Set(Object.values(this.session.store.project.assets).map((a) => a.remote).filter(Boolean));
    const items = await client.list(MEDIA);
    return items
      .filter((o) => MEDIA_EXTENSIONS.test(o.key))
      .map((o: S3Object) => ({ key: o.key, name: o.key.split('/').pop() ?? o.key, size: o.size, lastModified: o.lastModified, inProject: known.has(o.key) }));
  }

  private async input(key: string, name: string, size: number, lastModified: number): Promise<RemoteMedia> {
    return { kind: 'remote', url: await this.require().presign(key, URL_LIFETIME), name, size, lastModified };
  }

  async importMedia(keys: readonly string[], place = true): Promise<AssetMeta[]> {
    const client = this.require();
    const out: AssetMeta[] = [];
    for (const key of keys) {
      const head = await client.head(key);
      if (!head) throw new Error(`${key} is not in the bucket`);
      const name = key.split('/').pop() ?? key;
      out.push(await this.session.importRemote(await this.input(key, name, head.size, head.lastModified), key, place));
    }
    return out;
  }

  async upload(assetIds?: readonly string[], onProgress: (name: string, fraction: number) => void = () => undefined, signal?: AbortSignal): Promise<string[]> {
    const client = this.require();
    const { assets } = this.session.store.project;
    const ids = assetIds ?? Object.keys(assets).filter((id) => !assets[id].remote && !assets[id].timeline);
    const uploaded: string[] = [];
    for (const id of ids) {
      const meta = assets[id];
      const file = this.session.files.get(id);
      if (!meta || meta.remote) continue;
      if (!(file instanceof File)) throw new Error(`"${meta.name}" is offline; connect it before uploading`);
      const key = client.key(`${MEDIA}${safeName(meta.name)}`);
      const existing = await client.head(key);
      if (existing && existing.size !== file.size) throw new Error(`Another file named "${meta.name}" is already in the bucket`);
      if (!existing) {
        await client.upload(key, file, (fraction) => {
          onProgress(meta.name, fraction);
          this.emit('progress', { task: 'upload', name: meta.name, fraction });
        }, signal);
      }
      this.session.store.dispatch(addAsset({ ...this.session.store.project.assets[id], remote: key }), { history: false });
      uploaded.push(key);
    }
    return uploaded;
  }

  async attachMissing(): Promise<number> {
    if (!this.client || this.attaching) return 0;
    this.attaching = true;
    let attached = 0;
    try {
      for (const id of this.session.missing) {
        const meta = this.session.store.project.assets[id];
        if (!meta?.remote) continue;
        const head = await this.client.head(meta.remote).catch(() => null);
        if (!head) continue;
        this.session.attachFile(meta, await this.input(meta.remote, meta.name, head.size, head.lastModified));
        attached++;
      }
    } finally {
      this.attaching = false;
    }
    return attached;
  }
}
