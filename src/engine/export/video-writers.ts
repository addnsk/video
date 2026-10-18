import { CanvasSource, EncodedPacket, EncodedVideoPacketSource, type Output, type Quality, type VideoCodec } from 'mediabunny';
import type { FullFrame, RenderOptions } from '../gpu/compositor';
import { ENCODINGS, toPlanes422, type DynamicRange } from './prores/color';

const CONTAINER_COLORS = {
  sdr: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  hlg: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false },
  pq: { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false },
} as unknown as Record<DynamicRange, VideoColorSpaceInit>;
import { createFrameEncoder } from './prores/encoder-pool';
import { PROFILES, type ProresProfile } from './prores/tables';

export interface VideoWriter {
  readonly renderOptions: RenderOptions;
  add(timestamp: number, duration: number): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

export function canvasWriter(output: Output, canvas: OffscreenCanvas, codec: VideoCodec, bitrate: number | Quality, frameRate: number): VideoWriter {
  const source = new CanvasSource(canvas, { codec, bitrate });
  output.addVideoTrack(source, { frameRate });
  return {
    renderOptions: {},
    add: (timestamp, duration) => source.add(timestamp, duration),
    finish: async () => source.close(),
    abort: () => undefined,
  };
}

export function proresWriter(output: Output, profile: ProresProfile, range: DynamicRange, frameRate: number, threads: number): VideoWriter {
  const encoding = ENCODINGS[range];
  const source = new EncodedVideoPacketSource('prores');
  output.addVideoTrack(source, { frameRate });
  const encoder = createFrameEncoder(profile, encoding.tags, threads);
  const inFlight: { packet: Promise<Uint8Array>; timestamp: number; duration: number }[] = [];
  let frame: FullFrame | null = null;
  let first = true;
  const drainOne = async () => {
    const job = inFlight.shift()!;
    const data = await job.packet;
    const packet = new EncodedPacket(data, 'key', job.timestamp, job.duration);
    const { width, height } = frameSize!;
    const meta = first ? { decoderConfig: { codec: PROFILES[profile].fourCc, codedWidth: width, codedHeight: height, colorSpace: CONTAINER_COLORS[range] } } : undefined;
    first = false;
    await source.add(packet, meta);
  };
  let frameSize: { width: number; height: number } | null = null;
  return {
    renderOptions: { readback: (f) => (frame = f) },
    async add(timestamp, duration) {
      if (!frame) throw new Error('No frame was rendered');
      const planes = toPlanes422(frame, undefined, encoding);
      frameSize = { width: planes.width, height: planes.height };
      frame = null;
      inFlight.push({ packet: encoder.encode(planes), timestamp, duration });
      if (inFlight.length > Math.max(1, threads)) await drainOne();
    },
    async finish() {
      while (inFlight.length) await drainOne();
      encoder.close();
      source.close();
    },
    abort: () => encoder.close(),
  };
}
