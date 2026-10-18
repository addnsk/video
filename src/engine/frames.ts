import type { Project } from '../core/model';
import { placeTrack, type CompositionFrame, type LayerFrame, type Placement } from '../core/timeline';
import type { MemoryBudget } from './device';
import { downscale, type FrameImage, type OwnedFrame } from './media/frame';
import { FrameCache } from './media/frame-cache';
import type { MediaPool, Quality } from './media/media-pool';
import { SequentialReader, readStill } from './media/video-reader';

export const layersOf = (frame: CompositionFrame): LayerFrame[] =>
  frame.layers.flatMap((l) => (l.transition ? [l.base, l.transition.incoming] : [l.base]));

export class StillFrames {
  private cache: FrameCache;
  private pinned = new Set<string>();

  constructor(
    private pool: MediaPool,
    private budget: MemoryBudget,
  ) {
    this.cache = new FrameCache(budget.frameCacheBytes);
  }

  async load(project: Project, frame: CompositionFrame, isStale: () => boolean): Promise<Map<string, FrameImage> | null> {
    const layers = layersOf(frame);
    this.pinned.clear();
    const results = await Promise.all(layers.map((layer) => this.loadLayer(project, layer)));
    if (isStale()) return null;
    const images = new Map<string, FrameImage>();
    layers.forEach((layer, i) => {
      const image = results[i];
      if (image) images.set(layer.placement.item.id, image);
    });
    return images;
  }

  private async loadLayer(project: Project, layer: LayerFrame): Promise<FrameImage | null> {
    const { assetId } = layer.placement.item.source;
    if (!this.pool.has(assetId)) return null;
    const fps = project.assets[assetId]?.fps || 25;
    const quality: Quality = this.pool.hasProxy(assetId) ? 'preview' : 'master';
    const key = `${assetId}:${quality}:${Math.round(layer.sourceTime * fps)}`;
    this.pinned.add(key);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const media = this.pool.acquire(assetId, quality);
    const raw = await readStill(media, layer.sourceTime, `${assetId}:${quality}`);
    if (!raw) return null;
    const small = await downscale(raw, this.budget.previewMaxHeight);
    const keyed: OwnedFrame = { ...small, key, release: () => small.release() };
    this.cache.put(key, keyed, this.pinned);
    return keyed;
  }

  clear(): void {
    this.cache.clear();
  }

  get cachedBytes(): number {
    return this.cache.size;
  }
}

const PREFETCH_SECONDS = 1;

export class SequentialFrames {
  private readers = new Map<string, SequentialReader>();

  constructor(
    private pool: MediaPool,
    private quality: Quality,
  ) {}

  async load(project: Project, frame: CompositionFrame): Promise<Map<string, FrameImage>> {
    const layers = layersOf(frame).filter((l) => this.pool.has(l.placement.item.source.assetId));
    const wanted = new Set(layers.map((l) => l.placement.item.id));
    const upcoming = this.upcoming(project, frame.time, wanted);
    for (const [id, reader] of this.readers) {
      if (wanted.has(id) || upcoming.some((p) => p.item.id === id)) continue;
      reader.close();
      this.readers.delete(id);
    }
    for (const p of upcoming) void this.reader(p, p.item.source.in).frameAt(p.item.source.in);
    const images = await Promise.all(layers.map((l) => this.reader(l.placement, l.sourceTime).frameAt(l.sourceTime)));
    const out = new Map<string, FrameImage>();
    layers.forEach((l, i) => {
      const image = images[i];
      if (image) out.set(l.placement.item.id, image);
    });
    return out;
  }

  private upcoming(project: Project, time: number, visible: Set<string>): Placement[] {
    const out: Placement[] = [];
    for (const track of project.tracks) {
      if (track.kind !== 'video' || track.muted) continue;
      for (const p of placeTrack(track))
        if (!visible.has(p.item.id) && this.pool.has(p.item.source.assetId) && p.start > time && p.start - time < PREFETCH_SECONDS) out.push(p);
    }
    return out;
  }

  private reader(placement: Placement, time: number): SequentialReader {
    const { item } = placement;
    const quality: Quality = this.quality === 'preview' && this.pool.hasProxy(item.source.assetId) ? 'preview' : 'master';
    let reader = this.readers.get(item.id);
    if (reader && !reader.canServe(time, item.source.out)) {
      reader.close();
      reader = undefined;
    }
    if (!reader) {
      const media = this.pool.acquire(item.source.assetId, quality);
      reader = new SequentialReader(media, time, item.source.out, `${item.source.assetId}:${quality}:seq`);
      this.readers.set(item.id, reader);
    }
    return reader;
  }

  close(): void {
    for (const reader of this.readers.values()) reader.close();
    this.readers.clear();
  }
}
