import { CanvasSource, EncodedPacket, EncodedVideoPacketSource, type Output, type Quality, type VideoCodec } from 'mediabunny';
import type { FullFrame, RenderOptions } from '../gpu/compositor';
import { toPlanes422 } from './prores/color';
import { ProresFrameEncoder, type Planes422 } from './prores/encoder';
import { PROFILES, type ProresProfile } from './prores/tables';

export interface VideoWriter {
  readonly renderOptions: RenderOptions;
  add(timestamp: number, duration: number): Promise<void>;
  close(): void;
}

export function canvasWriter(output: Output, canvas: OffscreenCanvas, codec: VideoCodec, bitrate: number | Quality, frameRate: number): VideoWriter {
  const source = new CanvasSource(canvas, { codec, bitrate });
  output.addVideoTrack(source, { frameRate });
  return {
    renderOptions: {},
    add: (timestamp, duration) => source.add(timestamp, duration),
    close: () => source.close(),
  };
}

export function proresWriter(output: Output, profile: ProresProfile, frameRate: number): VideoWriter {
  const source = new EncodedVideoPacketSource('prores');
  output.addVideoTrack(source, { frameRate });
  const encoder = new ProresFrameEncoder(profile);
  let frame: FullFrame | null = null;
  let planes: Planes422 | undefined;
  let first = true;
  return {
    renderOptions: { readback: (f) => (frame = f) },
    async add(timestamp, duration) {
      if (!frame) throw new Error('No frame was rendered');
      planes = toPlanes422(frame, planes);
      frame = null;
      const packet = new EncodedPacket(encoder.encode(planes), 'key', timestamp, duration);
      const meta = first ? { decoderConfig: { codec: PROFILES[profile].fourCc, codedWidth: planes.width, codedHeight: planes.height } } : undefined;
      first = false;
      await source.add(packet, meta);
    },
    close: () => source.close(),
  };
}
