import { ALL_FORMATS, Input, type MetadataTags } from 'mediabunny';
import type { AssetMeta } from '../../core/model';
import { sourceOf, type MediaInput } from './media-input';

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'ProRes',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  'pcm-s16': 'PCM',
  'pcm-s24': 'PCM',
  'pcm-f32': 'PCM',
};

export const codecLabel = (codec: string): string => CODEC_LABELS[codec] ?? codec;

export class UnsupportedMediaError extends Error {}

const CAMERA_LOG_PROFILES: readonly { pattern: RegExp; colorSpace: string }[] = [
  { pattern: /blackmagic-design\.cinemacamera\.filmlog/i, colorSpace: 'bmdFilmGen5' },
  { pattern: /s-?log3/i, colorSpace: 'slog3' },
  { pattern: /log-?c/i, colorSpace: 'logc3' },
  { pattern: /v-?log/i, colorSpace: 'vlog' },
  { pattern: /c(anon)?-?log ?3/i, colorSpace: 'clog3' },
];

function colorSpaceFor(tags: MetadataTags | null): Pick<AssetMeta, 'colorSpace'> {
  const gamma = tags?.raw?.['com.apple.proapps.customgamma'];
  if (typeof gamma !== 'string') return {};
  const profile = CAMERA_LOG_PROFILES.find((p) => p.pattern.test(gamma));
  return profile ? { colorSpace: profile.colorSpace } : {};
}

async function hdrColorSpace(video: Awaited<ReturnType<Input['getPrimaryVideoTrack']>>): Promise<Pick<AssetMeta, 'colorSpace'>> {
  const space = video ? await video.getColorSpace().catch(() => null) : null;
  const transfer = String(space?.transfer ?? '');
  if (transfer === 'pq') return { colorSpace: 'rec2020Pq' };
  if (transfer === 'hlg') return { colorSpace: 'rec2020Hlg' };
  return {};
}

export async function probe(file: MediaInput, id: string): Promise<AssetMeta> {
  const input = new Input({ source: sourceOf(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    const audio = audioTrack && (await audioTrack.canDecode()) ? audioTrack : null;
    if (!video && !audio) throw new UnsupportedMediaError(`"${file.name}" has no playable video or audio`);
    const videoCodec = video ? ((await video.getCodec()) ?? 'unknown') : null;
    if (video && !(await video.canDecode())) throw new UnsupportedMediaError(`This browser cannot decode ${codecLabel(videoCodec!)} ("${file.name}")`);
    const audioCodec = audio ? ((await audio.getCodec()) ?? 'audio') : null;
    const [width, height, start, end, stats, sampleRate, channels] = await Promise.all([
      video ? video.getDisplayWidth() : 0,
      video ? video.getDisplayHeight() : 0,
      video ? video.getFirstTimestamp() : audio!.getFirstTimestamp(),
      input.computeDuration(),
      video ? video.computePacketStats(60) : null,
      audio ? audio.getSampleRate() : 0,
      audio ? audio.getNumberOfChannels() : 0,
    ]);
    return {
      id,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      codec: codecLabel(videoCodec ?? audioCodec ?? 'unknown'),
      width,
      height,
      fps: stats ? Math.round(stats.averagePacketRate * 1000) / 1000 || 25 : 0,
      start,
      end,
      hasVideo: !!video,
      hasAudio: !!audio,
      sampleRate,
      channels,
      ...(await hdrColorSpace(video)),
      ...colorSpaceFor(await input.getMetadataTags().catch(() => null)),
    };
  } finally {
    input.dispose();
  }
}
