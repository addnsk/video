export type ResourceKind = 'videoSample' | 'bitmap' | 'texture' | 'framebuffer' | 'decoder' | 'audioSample';

export class ResourceTracker {
  private live = new Map<ResourceKind, number>();
  private peak = new Map<ResourceKind, number>();
  private bytes = new Map<ResourceKind, number>();

  acquire(kind: ResourceKind, size = 0): void {
    const n = (this.live.get(kind) ?? 0) + 1;
    this.live.set(kind, n);
    this.peak.set(kind, Math.max(this.peak.get(kind) ?? 0, n));
    this.bytes.set(kind, (this.bytes.get(kind) ?? 0) + size);
  }

  release(kind: ResourceKind, size = 0): void {
    this.live.set(kind, (this.live.get(kind) ?? 0) - 1);
    this.bytes.set(kind, (this.bytes.get(kind) ?? 0) - size);
  }

  snapshot(): Record<string, { live: number; peak: number; bytes: number }> {
    const out: Record<string, { live: number; peak: number; bytes: number }> = {};
    for (const [kind, live] of this.live) out[kind] = { live, peak: this.peak.get(kind) ?? 0, bytes: this.bytes.get(kind) ?? 0 };
    return out;
  }
}

export const resources = new ResourceTracker();
