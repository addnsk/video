import type { VideoSample } from 'mediabunny';
import type { MediaFile } from './media-file';
import { frameFromSample, sampleBytes, type FrameImage, type OwnedFrame } from './frame';
import { resources } from '../resources';

const EPSILON = 1e-4;

export class SequentialReader {
  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;
  private upcoming: VideoSample | null = null;
  private finished = false;
  private releaseMedia: () => void;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private media: MediaFile,
    readonly from: number,
    readonly to: number,
    private keyPrefix: string,
  ) {
    this.releaseMedia = media.retain();
  }

  canServe(time: number, to: number): boolean {
    return time >= this.from - EPSILON && to === this.to && !this.finished;
  }

  frameAt(time: number): Promise<FrameImage | null> {
    const run = this.pending.then(() => this.advance(time));
    this.pending = run.catch(() => undefined);
    return run;
  }

  private async advance(time: number): Promise<FrameImage | null> {
    const local = time + this.media.timeOffset;
    if (!this.iterator) {
      const sink = await this.media.video();
      if (!sink) return null;
      this.iterator = sink.samples(this.from + this.media.timeOffset, this.to + this.media.timeOffset);
      await this.pull();
    }
    while (this.upcoming && (this.current === null || this.upcoming.timestamp <= local + EPSILON)) {
      this.drop(this.current);
      this.current = this.upcoming;
      this.upcoming = null;
      await this.pull();
    }
    const sample = this.current ?? this.upcoming;
    if (!sample) return null;
    return {
      source: sample.toCanvasImageSource(),
      width: sample.displayWidth,
      height: sample.displayHeight,
      timestamp: sample.timestamp,
      key: `${this.keyPrefix}:${sample.timestamp}`,
    };
  }

  private drop(sample: VideoSample | null) {
    if (!sample) return;
    resources.release('videoSample', sampleBytes(sample));
    sample.close();
  }

  private async pull() {
    if (this.finished || !this.iterator) return;
    const next = await this.iterator.next();
    if (next.done) this.finished = true;
    else {
      resources.acquire('videoSample', sampleBytes(next.value));
      this.upcoming = next.value;
    }
  }

  close(): void {
    void this.pending.then(() => {
      void this.iterator?.return();
      this.drop(this.current);
      this.drop(this.upcoming);
      this.current = this.upcoming = null;
      this.releaseMedia();
    });
  }
}

export async function readStill(media: MediaFile, time: number, keyPrefix: string): Promise<OwnedFrame | null> {
  const release = media.retain();
  try {
    const sink = await media.video();
    const sample = await sink?.getSample(time + media.timeOffset);
    return sample ? frameFromSample(sample, `${keyPrefix}:${sample.timestamp}`) : null;
  } finally {
    release();
  }
}
