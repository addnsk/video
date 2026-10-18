import { metrics } from '../metrics';
import { resources } from '../resources';
import type { FrameStore } from './frame-store';

export interface CachedFrame {
  readonly bitmap: ImageBitmap;
  readonly bytes: number;
}

export interface FrameEncoder {
  encode(bitmap: ImageBitmap): Promise<Blob>;
  decode(blob: Blob): Promise<ImageBitmap>;
}

export const pngEncoder: FrameEncoder = {
  async encode(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('bitmaprenderer')!.transferFromImageBitmap(await createImageBitmap(bitmap));
    return canvas.convertToBlob({ type: 'image/png' });
  },
  decode: (blob) => createImageBitmap(blob),
};

export interface RenderCacheLimits {
  readonly memoryBytes: number;
  readonly diskBytes: number;
}

const MAX_SPILLS_IN_FLIGHT = 2;

export class RenderCache {
  private memory = new Map<string, CachedFrame>();
  private disk = new Map<string, number>();
  private memoryBytes = 0;
  private diskBytes = 0;
  private spilling = 0;
  private loading = new Map<string, Promise<ImageBitmap | null>>();

  constructor(
    private limits: RenderCacheLimits,
    private store: FrameStore | null = null,
    private encoder: FrameEncoder = pngEncoder,
  ) {}

  setLimits(limits: Partial<RenderCacheLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.trim(this.limits.memoryBytes);
  }

  attach(store: FrameStore | null): void {
    this.store = store;
  }

  get bytes(): number {
    return this.memoryBytes;
  }

  get diskUsage(): number {
    return this.diskBytes;
  }

  get entries(): { memory: number; disk: number } {
    return { memory: this.memory.size, disk: this.disk.size };
  }

  peek(key: string): ImageBitmap | null {
    const hit = this.memory.get(key);
    if (!hit) return null;
    this.memory.delete(key);
    this.memory.set(key, hit);
    metrics.count('renderCache.hit.memory');
    return hit.bitmap;
  }

  onDisk(key: string): boolean {
    return this.disk.has(key);
  }

  load(key: string): Promise<ImageBitmap | null> {
    const memory = this.peek(key);
    if (memory) return Promise.resolve(memory);
    if (!this.store || !this.disk.has(key)) return Promise.resolve(null);
    let pending = this.loading.get(key);
    if (!pending) {
      pending = this.store
        .read(key)
        .then(async (blob) => {
          if (!blob) {
            this.forget(key);
            return null;
          }
          const bitmap = await this.encoder.decode(blob);
          metrics.count('renderCache.hit.disk');
          this.keep(key, bitmap);
          return bitmap;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    return pending;
  }

  put(key: string, bitmap: ImageBitmap): void {
    if (this.memory.has(key)) {
      bitmap.close();
      return;
    }
    metrics.count('renderCache.stored');
    this.keep(key, bitmap);
  }

  trim(keepBytes = 0): void {
    for (const [key, entry] of this.memory) {
      if (this.memoryBytes <= keepBytes) break;
      this.evict(key, entry, false);
    }
  }

  clear(): void {
    for (const entry of this.memory.values()) {
      entry.bitmap.close();
      resources.release('bitmap', entry.bytes);
    }
    this.memory.clear();
    this.memoryBytes = 0;
    this.disk.clear();
    this.diskBytes = 0;
    void this.store?.clear();
  }

  private keep(key: string, bitmap: ImageBitmap) {
    const bytes = bitmap.width * bitmap.height * 4;
    if (bytes > this.limits.memoryBytes) {
      bitmap.close();
      return;
    }
    this.memory.set(key, { bitmap, bytes });
    this.memoryBytes += bytes;
    resources.acquire('bitmap', bytes);
    for (const [k, entry] of this.memory) {
      if (this.memoryBytes <= this.limits.memoryBytes) break;
      this.evict(k, entry, true);
    }
  }

  private evict(key: string, entry: CachedFrame, spill: boolean) {
    this.memory.delete(key);
    this.memoryBytes -= entry.bytes;
    resources.release('bitmap', entry.bytes);
    if (spill && this.store && !this.disk.has(key) && this.spilling < MAX_SPILLS_IN_FLIGHT) void this.spill(key, entry.bitmap);
    else entry.bitmap.close();
  }

  private async spill(key: string, bitmap: ImageBitmap) {
    this.spilling++;
    try {
      const blob = await this.encoder.encode(bitmap);
      await this.store!.write(key, blob);
      this.disk.set(key, blob.size);
      this.diskBytes += blob.size;
      metrics.count('renderCache.spilled');
      for (const [k, size] of this.disk) {
        if (this.diskBytes <= this.limits.diskBytes) break;
        this.disk.delete(k);
        this.diskBytes -= size;
        void this.store!.remove(k);
      }
    } catch {
      metrics.count('renderCache.spillFailed');
    } finally {
      bitmap.close();
      this.spilling--;
    }
  }

  private forget(key: string) {
    const size = this.disk.get(key);
    if (size === undefined) return;
    this.disk.delete(key);
    this.diskBytes -= size;
  }
}
