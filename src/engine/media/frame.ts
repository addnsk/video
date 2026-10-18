import type { VideoSample } from 'mediabunny';
import { resources } from '../resources';

export interface FrameImage {
  readonly source: TexImageSource;
  readonly width: number;
  readonly height: number;
  readonly timestamp: number;
  readonly key: string;
}

export interface OwnedFrame extends FrameImage {
  release(): void;
}

export function frameFromSample(sample: VideoSample, key: string): OwnedFrame {
  resources.acquire('videoSample');
  let released = false;
  return {
    source: sample.toCanvasImageSource(),
    width: sample.displayWidth,
    height: sample.displayHeight,
    timestamp: sample.timestamp,
    key,
    release() {
      if (released) return;
      released = true;
      sample.close();
      resources.release('videoSample');
    },
  };
}

export async function downscale(frame: OwnedFrame, maxHeight: number): Promise<OwnedFrame> {
  if (frame.height <= maxHeight) {
    const bitmap = await createImageBitmap(frame.source as ImageBitmapSource);
    frame.release();
    return bitmapFrame(bitmap, frame.timestamp, frame.key);
  }
  const height = maxHeight;
  const width = Math.max(2, Math.round((frame.width * height) / frame.height));
  const bitmap = await createImageBitmap(frame.source as ImageBitmapSource, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'medium',
  });
  frame.release();
  return bitmapFrame(bitmap, frame.timestamp, frame.key);
}

function bitmapFrame(bitmap: ImageBitmap, timestamp: number, key: string): OwnedFrame {
  const bytes = bitmap.width * bitmap.height * 4;
  resources.acquire('bitmap', bytes);
  let released = false;
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    timestamp,
    key,
    release() {
      if (released) return;
      released = true;
      bitmap.close();
      resources.release('bitmap', bytes);
    },
  };
}

export const frameBytes = (frame: FrameImage): number => frame.width * frame.height * 4;
