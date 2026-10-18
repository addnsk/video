import { resources } from '../resources';
import { sampleBytes } from '../media/frame';
import type { MediaFile } from '../media/media-file';
import { lumaFromRgba, PointTracker, type TrackOptions } from './tracker';

export interface TrackSample {
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
}

export interface MediaTrackOptions extends TrackOptions {
  readonly height: number;
}

export async function trackMedia(media: MediaFile, times: readonly number[], start: { x: number; y: number }, options: MediaTrackOptions): Promise<TrackSample[]> {
  const release = media.retain();
  const out: TrackSample[] = [];
  try {
    const sink = await media.video();
    if (!sink) return out;
    let tracker: PointTracker | null = null;
    let canvas: OffscreenCanvas | null = null;
    let index = 0;
    for await (const sample of sink.samplesAtTimestamps(times.map((t) => t + media.timeOffset))) {
      const time = times[index++];
      if (!sample) continue;
      const bytes = sampleBytes(sample);
      resources.acquire('videoSample', bytes);
      try {
        const height = Math.min(options.height, sample.displayHeight);
        const width = Math.max(2, Math.round((sample.displayWidth * height) / sample.displayHeight));
        canvas ??= new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(sample.toCanvasImageSource() as CanvasImageSource, 0, 0, width, height);
        const luma = lumaFromRgba(context.getImageData(0, 0, width, height).data, width, height);
        tracker ??= new PointTracker(options, start.x * width, start.y * height);
        const result = tracker.step(luma);
        out.push({ time, x: result.x / width, y: result.y / height, confidence: result.confidence });
      } finally {
        sample.close();
        resources.release('videoSample', bytes);
      }
    }
    return out;
  } finally {
    release();
  }
}
