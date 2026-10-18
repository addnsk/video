import type { MediaFile } from '../media/media-file';
import { resources } from '../resources';

export const PEAKS_PER_SECOND = 100;

export async function computePeaks(media: MediaFile): Promise<Float32Array> {
  const release = media.retain();
  try {
    const sink = await media.audio();
    if (!sink) return new Float32Array(0);
    const buckets: number[] = [];
    for await (const sample of sink.samples()) {
      resources.acquire('audioSample');
      try {
        const frames = sample.numberOfFrames;
        const data = new Float32Array(frames);
        sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
        const perBucket = sample.sampleRate / PEAKS_PER_SECOND;
        const first = Math.floor(sample.timestamp * PEAKS_PER_SECOND);
        for (let i = 0; i < frames; i++) {
          const bucket = first + Math.floor(i / perBucket);
          const v = Math.abs(data[i]);
          if (!(buckets[bucket] >= v)) buckets[bucket] = v;
        }
      } finally {
        sample.close();
        resources.release('audioSample');
      }
    }
    return Float32Array.from(buckets, (v) => v ?? 0);
  } finally {
    release();
  }
}
