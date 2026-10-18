import type { AssetMeta } from '../../core/model';
import type { MemoryBudget } from '../device';
import { MediaFile } from './media-file';

export type Quality = 'preview' | 'master';

interface Entry {
  meta: AssetMeta;
  original: File;
  proxy: { file: File; offset: number } | null;
  open: Map<Quality, MediaFile>;
}

export class MediaPool {
  private entries = new Map<string, Entry>();

  constructor(private budget: MemoryBudget) {}

  register(meta: AssetMeta, file: File): void {
    const existing = this.entries.get(meta.id);
    if (existing) {
      existing.meta = meta;
      return;
    }
    this.entries.set(meta.id, { meta, original: file, proxy: null, open: new Map() });
  }

  has(assetId: string): boolean {
    return this.entries.has(assetId);
  }

  meta(assetId: string): AssetMeta | undefined {
    return this.entries.get(assetId)?.meta;
  }

  original(assetId: string): File | undefined {
    return this.entries.get(assetId)?.original;
  }

  setProxy(assetId: string, file: File, offset: number): void {
    const entry = this.entries.get(assetId);
    if (!entry) return;
    entry.proxy = { file, offset };
    const preview = entry.open.get('preview');
    if (preview && !preview.busy) {
      preview.dispose();
      entry.open.delete('preview');
    }
  }

  hasProxy(assetId: string): boolean {
    return !!this.entries.get(assetId)?.proxy;
  }

  acquire(assetId: string, quality: Quality): MediaFile {
    const entry = this.entries.get(assetId);
    if (!entry) throw new Error(`Media for asset ${assetId} is not loaded`);
    const wanted: Quality = quality === 'preview' && entry.proxy ? 'preview' : 'master';
    let media = entry.open.get(wanted);
    if (!media) {
      media = wanted === 'preview' ? new MediaFile(entry.proxy!.file, entry.proxy!.offset) : new MediaFile(entry.original, 0);
      entry.open.set(wanted, media);
      this.evict();
    }
    media.lastUsed = performance.now();
    return media;
  }

  private evict(): void {
    const open: { entry: Entry; quality: Quality; media: MediaFile }[] = [];
    for (const entry of this.entries.values())
      for (const [quality, media] of entry.open) open.push({ entry, quality, media });
    const excess = open.length - this.budget.maxOpenSources;
    if (excess <= 0) return;
    open
      .filter((o) => !o.media.busy)
      .sort((a, b) => a.media.lastUsed - b.media.lastUsed)
      .slice(0, excess)
      .forEach(({ entry, quality, media }) => {
        media.dispose();
        entry.open.delete(quality);
      });
  }

  dispose(): void {
    for (const entry of this.entries.values()) for (const media of entry.open.values()) media.dispose();
    this.entries.clear();
  }
}
