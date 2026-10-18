import { CustomVideoEncoder, EncodedPacket, registerEncoder, type VideoCodec, type VideoSample } from 'mediabunny';
import { rgbaToPlanes422 } from './color';
import { ProresFrameEncoder, type Planes422 } from './encoder';
import { PROFILES, profileForFourCc } from './tables';

class ProresVideoEncoder extends CustomVideoEncoder {
  private encoder: ProresFrameEncoder | null = null;
  private canvas: OffscreenCanvas | null = null;
  private context: OffscreenCanvasRenderingContext2D | null = null;
  private planes: Planes422 | undefined;
  private sentConfig = false;

  static override supports(codec: VideoCodec, config: VideoEncoderConfig): boolean {
    return codec === 'prores' && profileForFourCc(config.codec) !== null && config.width % 2 === 0;
  }

  init(): void {
    this.encoder = new ProresFrameEncoder(profileForFourCc(this.config.codec)!);
    this.canvas = new OffscreenCanvas(this.config.width, this.config.height);
    this.context = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  encode(sample: VideoSample): void {
    const { width, height } = this.config;
    const context = this.context!;
    context.drawImage(sample.toCanvasImageSource(), 0, 0, width, height);
    this.planes = rgbaToPlanes422(context.getImageData(0, 0, width, height).data, width, height, this.planes);
    const data = this.encoder!.encode(this.planes);
    const packet = new EncodedPacket(data, 'key', sample.timestamp, sample.duration);
    if (this.sentConfig) this.onPacket(packet);
    else {
      this.sentConfig = true;
      this.onPacket(packet, { decoderConfig: { codec: this.config.codec, codedWidth: width, codedHeight: height } });
    }
  }

  flush(): void {}

  close(): void {
    this.encoder = null;
    this.context = null;
    this.canvas = null;
    this.planes = undefined;
  }
}

let registered = false;

export function registerProresEncoder(): void {
  if (registered) return;
  registered = true;
  registerEncoder(ProresVideoEncoder);
}

const REFERENCE_PIXELS = 1920 * 1080;

export const proresBitrate = (profile: keyof typeof PROFILES, width: number, height: number): number =>
  Math.round(PROFILES[profile].targetBitrate * ((width * height) / REFERENCE_PIXELS) ** 0.95);
