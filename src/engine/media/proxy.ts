import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  StreamTarget,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { AssetMeta } from '../../core/model';
import { opfsFile } from '../storage';
import { MediaFile } from './media-file';

const PROXY_DIR = 'proxies';

export const proxyName = (asset: AssetMeta, height: number) =>
  `${asset.id}-${asset.size}-${asset.lastModified}-${height}.mp4`;

export interface ProxyResult {
  file: File;
  offset: number;
}

export async function findProxy(asset: AssetMeta, height: number): Promise<ProxyResult | null> {
  const file = await opfsFile(PROXY_DIR, proxyName(asset, height)).read();
  if (!file || file.size === 0) return null;
  return { file, offset: await proxyOffset(file, asset) };
}

async function proxyOffset(file: File, asset: AssetMeta): Promise<number> {
  const media = new MediaFile(file, 0);
  try {
    return (await media.firstTimestamp()) - asset.start;
  } finally {
    media.dispose();
  }
}

export async function buildProxy(
  original: File,
  asset: AssetMeta,
  height: number,
  onProgress: (fraction: number) => void,
  isCanceled: () => boolean,
): Promise<ProxyResult> {
  const outHeight = Math.min(height, asset.height);
  const outWidth = Math.round((asset.width * outHeight) / asset.height / 2) * 2;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'hevc'], { width: outWidth, height: outHeight });
  if (!codec) throw new Error(`No encoder available to build a proxy for "${asset.name}"`);
  const target = opfsFile(PROXY_DIR, proxyName(asset, height));
  const sink = await target.open();
  const input = new Input({ source: new BlobSource(original), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(sink.writable, { chunked: true }),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { width: outWidth, height: outHeight, fit: 'contain', codec, quality: QUALITY_MEDIUM },
      audio: { discard: true },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
      throw new Error(`Cannot build a proxy for "${asset.name}": ${reasons}`);
    }
    conversion.onProgress = (p) => {
      onProgress(p);
      if (isCanceled()) void conversion.cancel();
    };
    await conversion.execute();
    if (isCanceled()) throw new Error('Proxy canceled');
    const file = await sink.finish();
    return { file, offset: await proxyOffset(file, asset) };
  } catch (e) {
    await sink.abort();
    throw e;
  } finally {
    input.dispose();
  }
}
