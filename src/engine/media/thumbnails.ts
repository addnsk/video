import { resources } from '../resources';
import type { MediaFile } from './media-file';

export async function decodeThumbnails(media: MediaFile, times: readonly number[], height: number): Promise<(ImageBitmap | null)[]> {
  const release = media.retain();
  const out: (ImageBitmap | null)[] = [];
  try {
    const sink = await media.video();
    if (!sink) return times.map(() => null);
    for await (const sample of sink.samplesAtTimestamps(times.map((t) => t + media.timeOffset))) {
      if (!sample) {
        out.push(null);
        continue;
      }
      resources.acquire('videoSample');
      try {
        const width = Math.max(2, Math.round((sample.displayWidth * height) / sample.displayHeight));
        out.push(await createImageBitmap(sample.toCanvasImageSource() as ImageBitmapSource, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' }));
      } catch {
        out.push(null);
      } finally {
        sample.close();
        resources.release('videoSample');
      }
    }
    return out;
  } finally {
    release();
  }
}
