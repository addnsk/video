import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { AssetMeta } from '../../core/model';

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'ProRes',
};

export const codecLabel = (codec: string): string => CODEC_LABELS[codec] ?? codec;

export class UnsupportedMediaError extends Error {}

export async function probe(file: File, id: string): Promise<AssetMeta> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new UnsupportedMediaError(`"${file.name}" has no video track`);
    const codec = (await video.getCodec()) ?? 'unknown';
    if (!(await video.canDecode())) throw new UnsupportedMediaError(`This browser cannot decode ${codecLabel(codec)} ("${file.name}")`);
    const audio = await input.getPrimaryAudioTrack();
    const audible = audio && (await audio.canDecode()) ? audio : null;
    const [width, height, start, end, stats, sampleRate, channels] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getFirstTimestamp(),
      input.computeDuration(),
      video.computePacketStats(60),
      audible ? audible.getSampleRate() : 0,
      audible ? audible.getNumberOfChannels() : 0,
    ]);
    return {
      id,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      codec: codecLabel(codec),
      width,
      height,
      fps: Math.round(stats.averagePacketRate * 1000) / 1000 || 25,
      start,
      end,
      hasAudio: !!audible,
      sampleRate,
      channels,
    };
  } finally {
    input.dispose();
  }
}
