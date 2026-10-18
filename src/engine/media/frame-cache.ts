import type { OwnedFrame } from './frame';
import { frameBytes } from './frame';

export class FrameCache {
  private entries = new Map<string, OwnedFrame>();
  private bytes = 0;

  constructor(private capacity: number) {}

  get(key: string): OwnedFrame | undefined {
    const frame = this.entries.get(key);
    if (!frame) return undefined;
    this.entries.delete(key);
    this.entries.set(key, frame);
    return frame;
  }

  put(key: string, frame: OwnedFrame, pinned: ReadonlySet<string> = new Set()): void {
    const size = frameBytes(frame);
    if (size > this.capacity) {
      frame.release();
      return;
    }
    const previous = this.entries.get(key);
    if (previous) this.remove(key, previous);
    this.entries.set(key, frame);
    this.bytes += size;
    for (const [k, f] of this.entries) {
      if (this.bytes <= this.capacity) break;
      if (k !== key && !pinned.has(k)) this.remove(k, f);
    }
  }

  clear(): void {
    for (const [key, frame] of this.entries) this.remove(key, frame);
  }

  get size(): number {
    return this.bytes;
  }

  private remove(key: string, frame: OwnedFrame) {
    this.entries.delete(key);
    this.bytes -= frameBytes(frame);
    frame.release();
  }
}
