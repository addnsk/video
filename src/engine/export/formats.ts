import {
  Mp4OutputFormat,
  MovOutputFormat,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type OutputFormat,
  type Quality,
  type VideoCodec,
} from 'mediabunny';
import type { ProresProfile } from './prores/tables';
import { proresBitrate, registerProresEncoder } from './prores/video-encoder';

export interface ExportSettings {
  readonly height: number | null;
  readonly quality: 'high' | 'medium';
  readonly prores?: ProresProfile | null;
}

export interface FormatPlan {
  readonly output: OutputFormat;
  readonly videoCodec: VideoCodec;
  readonly videoBitrate: number | Quality;
  readonly audioCodec: AudioCodec | null;
  readonly audioBitrate: number | Quality;
}

export const exportExtension = (settings: ExportSettings): 'mov' | 'mp4' => (settings.prores ? 'mov' : 'mp4');

export const exportMimeType = (settings: ExportSettings): string => (settings.prores ? 'video/quicktime' : 'video/mp4');

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly hasAudio: boolean;
}

export async function planFormat(settings: ExportSettings, frame: Frame): Promise<FormatPlan> {
  const audioConfig = { numberOfChannels: frame.channels, sampleRate: frame.sampleRate };
  if (settings.prores) {
    registerProresEncoder();
    return {
      output: new MovOutputFormat({ fastStart: false }),
      videoCodec: 'prores',
      videoBitrate: proresBitrate(settings.prores, frame.width, frame.height),
      audioCodec: frame.hasAudio ? await getFirstEncodableAudioCodec(['pcm-s24', 'pcm-s16'], audioConfig) : null,
      audioBitrate: QUALITY_HIGH,
    };
  }
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: frame.width, height: frame.height });
  if (!videoCodec) throw new Error(`No video encoder supports ${frame.width}×${frame.height} in this browser`);
  return {
    output: new Mp4OutputFormat({ fastStart: false }),
    videoCodec,
    videoBitrate: settings.quality === 'medium' ? QUALITY_MEDIUM : QUALITY_HIGH,
    audioCodec: frame.hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], audioConfig) : null,
    audioBitrate: QUALITY_HIGH,
  };
}
