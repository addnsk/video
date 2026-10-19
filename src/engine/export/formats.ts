import {
  Mp4OutputFormat,
  MovOutputFormat,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type Output,
  type OutputFormat,
  type Quality,
} from 'mediabunny';
import type { DynamicRange } from './prores/color';
import type { ProresProfile } from './prores/tables';
import { canvasWriter, proresWriter, type VideoWriter } from './video-writers';

export interface ExportSettings {
  readonly height: number | null;
  readonly quality: 'high' | 'medium';
  readonly prores?: ProresProfile | null;
  readonly dynamicRange?: DynamicRange;
  readonly range?: { readonly in: number; readonly out: number } | null;
  readonly timeline?: string | null;
}

export interface FormatPlan {
  readonly output: OutputFormat;
  readonly audioCodec: AudioCodec | null;
  readonly audioBitrate: number | Quality;
  video(output: Output, canvas: OffscreenCanvas, frameRate: number, threads: number): VideoWriter;
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
  const profile = settings.prores;
  if (profile) {
    return {
      output: new MovOutputFormat({ fastStart: false }),
      audioCodec: frame.hasAudio ? await getFirstEncodableAudioCodec(['pcm-s24', 'pcm-s16'], audioConfig) : null,
      audioBitrate: QUALITY_HIGH,
      video: (output, _canvas, frameRate, threads) => proresWriter(output, profile, settings.dynamicRange ?? 'sdr', frameRate, threads),
    };
  }
  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: frame.width, height: frame.height });
  if (!codec) throw new Error(`No video encoder supports ${frame.width}×${frame.height} in this browser`);
  const bitrate = settings.quality === 'medium' ? QUALITY_MEDIUM : QUALITY_HIGH;
  return {
    output: new Mp4OutputFormat({ fastStart: false }),
    audioCodec: frame.hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], audioConfig) : null,
    audioBitrate: QUALITY_HIGH,
    video: (output, canvas, frameRate) => canvasWriter(output, canvas, codec, bitrate, frameRate),
  };
}
