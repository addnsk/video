import type { Project } from '../core/model';
import { placeTrack, type CompositionFrame, type LayerFrame, type Placement } from '../core/timeline';
import type { MemoryBudget } from './device';
import { downscale, type FrameImage, type OwnedFrame } from './media/frame';
import { FrameCache } from './media/frame-cache';
import type { MediaPool, Quality } from './media/media-pool';
import { SequentialReader, readStill } from './media/video-reader';
import type { TextRenderer } from './text';

export interface OutputSize {
  readonly width: number;
  readonly height: number;
}

export const layersOf = (frame: CompositionFrame): LayerFrame[] =>
  frame.layers.flatMap((l) => (l.transition ? [l.base, l.transition.incoming] : [l.base]));

export interface FrameSource {
  load(project: Project, frame: CompositionFrame, size: OutputSize): Promise<Map<string, FrameImage> | null>;
  close(): void;
}

abstract class LayeredSource implements FrameSource {
  constructor(
    protected pool: MediaPool,
    private text: TextRenderer,
  ) {}

  async load(project: Project, frame: CompositionFrame, size: OutputSize): Promise<Map<string, FrameImage> | null> {
    const layers = layersOf(frame);
    this.prepare(project, frame, layers);
    const images = await Promise.all(
      layers.map((layer) => {
        const { item } = layer.placement;
        if (item.kind === 'text') return this.text.render(item.text, size.width, size.height);
        if (!this.pool.has(item.source.assetId)) return null;
        return this.media(project, layer);
      }),
    );
    if (this.stale()) return null;
    const out = new Map<string, FrameImage>();
    layers.forEach((layer, i) => {
      const image = images[i];
      if (image) out.set(layer.placement.item.id, image);
    });
    return out;
  }

  protected prepare(_project: Project, _frame: CompositionFrame, _layers: LayerFrame[]): void {}

  protected stale(): boolean {
    return false;
  }

  protected abstract media(project: Project, layer: LayerFrame): Promise<FrameImage | null>;

  abstract close(): void;
}

export class StillFrames extends LayeredSource {
  private cache: FrameCache;
  private pinned = new Set<string>();
  isStale: () => boolean = () => false;

  constructor(pool: MediaPool, text: TextRenderer, private budget: MemoryBudget) {
    super(pool, text);
    this.cache = new FrameCache(budget.frameCacheBytes);
  }

  protected prepare(): void {
    this.pinned.clear();
  }

  protected stale(): boolean {
    return this.isStale();
  }

  protected async media(project: Project, layer: LayerFrame): Promise<FrameImage | null> {
    const item = layer.placement.item;
    if (item.kind !== 'media') return null;
    const { assetId } = item.source;
    const fps = project.assets[assetId]?.fps || 25;
    const quality: Quality = this.pool.hasProxy(assetId) ? 'preview' : 'master';
    const key = `${assetId}:${quality}:${Math.round(layer.sourceTime * fps)}`;
    this.pinned.add(key);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const raw = await readStill(this.pool.acquire(assetId, quality), layer.sourceTime, `${assetId}:${quality}`);
    if (!raw) return null;
    const small = await downscale(raw, this.budget.previewMaxHeight);
    const keyed: OwnedFrame = { ...small, key, release: () => small.release() };
    this.cache.put(key, keyed, this.pinned);
    return keyed;
  }

  close(): void {
    this.cache.clear();
  }

  get cachedBytes(): number {
    return this.cache.size;
  }
}

const PREFETCH_SECONDS = 1;

export class SequentialFrames extends LayeredSource {
  private readers = new Map<string, SequentialReader>();

  constructor(pool: MediaPool, text: TextRenderer, private quality: Quality) {
    super(pool, text);
  }

  protected prepare(project: Project, frame: CompositionFrame, layers: LayerFrame[]): void {
    const visible = new Set(layers.map((l) => l.placement.item.id));
    const upcoming = this.upcoming(project, frame.time, visible);
    for (const [id, reader] of this.readers) {
      if (visible.has(id) || upcoming.some((p) => p.item.id === id)) continue;
      reader.close();
      this.readers.delete(id);
    }
    for (const p of upcoming) {
      if (p.item.kind === 'media') void this.reader(p, p.item.source.in).frameAt(p.item.source.in);
    }
  }

  protected media(_project: Project, layer: LayerFrame): Promise<FrameImage | null> {
    return this.reader(layer.placement, layer.sourceTime).frameAt(layer.sourceTime);
  }

  private upcoming(project: Project, time: number, visible: Set<string>): Placement[] {
    const out: Placement[] = [];
    for (const track of project.tracks) {
      if (track.kind !== 'video' || track.muted) continue;
      for (const p of placeTrack(track)) {
        if (p.item.kind !== 'media' || visible.has(p.item.id) || !this.pool.has(p.item.source.assetId)) continue;
        if (p.start > time && p.start - time < PREFETCH_SECONDS) out.push(p);
      }
    }
    return out;
  }

  private reader(placement: Placement, time: number): SequentialReader {
    const item = placement.item;
    if (item.kind !== 'media') throw new Error('Not a media item');
    const { assetId, out } = item.source;
    const quality: Quality = this.quality === 'preview' && this.pool.hasProxy(assetId) ? 'preview' : 'master';
    let reader = this.readers.get(item.id);
    if (reader && !reader.canServe(time, out)) {
      reader.close();
      reader = undefined;
    }
    if (!reader) {
      reader = new SequentialReader(this.pool.acquire(assetId, quality), time, out, `${assetId}:${quality}:seq`);
      this.readers.set(item.id, reader);
    }
    return reader;
  }

  close(): void {
    for (const reader of this.readers.values()) reader.close();
    this.readers.clear();
  }
}
