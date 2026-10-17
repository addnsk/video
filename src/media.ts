import { Input, BlobSource, ALL_FORMATS, VideoSampleSink, AudioBufferSink } from 'mediabunny';
import { registerProresDecoder } from '@mediabunny/prores';
import { type Asset, uid } from './project';

registerProresDecoder();

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'ProRes',
};

export async function loadAsset(file: File): Promise<Asset> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error(`В «${file.name}» нет видеодорожки.`);
  const codec = (await video.getCodec()) ?? 'unknown';
  if (!(await video.canDecode())) {
    throw new Error(`Браузер не умеет декодировать ${CODEC_NAMES[codec] ?? codec} из «${file.name}».`);
  }
  let audio = await input.getPrimaryAudioTrack();
  if (audio && !(await audio.canDecode())) audio = null;

  const [width, height, start, end, stats] = await Promise.all([
    video.getDisplayWidth(),
    video.getDisplayHeight(),
    video.getFirstTimestamp(),
    input.computeDuration(),
    video.computePacketStats(50),
  ]);

  return {
    id: uid('a'),
    name: file.name,
    file,
    input,
    video,
    audio,
    frames: new VideoSampleSink(video),
    sound: audio ? new AudioBufferSink(audio) : null,
    codec: CODEC_NAMES[codec] ?? codec,
    width,
    height,
    fps: Math.round(stats.averagePacketRate * 1000) / 1000 || 25,
    start,
    end,
  };
}
