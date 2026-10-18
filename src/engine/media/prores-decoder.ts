import { CustomVideoDecoder, VideoSample, registerDecoder, type EncodedPacket, type VideoCodec } from 'mediabunny';
import { Decoder, Frame, PIXEL_FORMATS, type PixelFormat } from 'turbores';

const QUEUE_LIMIT = 2;

let supportedFormats: PixelFormat[] | null = null;

function frameFormats(): PixelFormat[] | undefined {
  if (typeof VideoFrame === 'undefined') return undefined;
  if (supportedFormats) return supportedFormats;
  const data = new Uint8Array(64);
  supportedFormats = PIXEL_FORMATS.filter((format) => {
    try {
      new VideoFrame(data, { format: format as VideoPixelFormat, codedWidth: 2, codedHeight: 2, timestamp: 0 }).close();
      return true;
    } catch {
      return false;
    }
  });
  return supportedFormats;
}

export class ProresDecoder extends CustomVideoDecoder {
  private decoder: Decoder | null = null;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  static override supports(codec: VideoCodec): boolean {
    return codec === 'prores';
  }

  async init(): Promise<void> {
    const decoder = await Decoder.create({
      proresFourCc: this.config.codec as Parameters<typeof Decoder.create>[0]['proresFourCc'],
      useSharedMemory: Decoder.canUseSharedMemory(),
      allowedOutputFormats: frameFormats(),
    });
    if (decoder instanceof Error) throw decoder;
    this.decoder = decoder;
  }

  private queued = 0;

  async decode(packet: EncodedPacket): Promise<void> {
    this.queued++;
    const run = this.pending.then(() => this.decodeOne(packet)).finally(() => this.queued--);
    this.pending = run.catch((error) => this.onError(error));
    if (this.queued >= QUEUE_LIMIT) await this.pending;
  }

  private async decodeOne(packet: EncodedPacket): Promise<void> {
    if (this.closed || !this.decoder) return;
    const frame = new Frame();
    try {
      const result = await this.decoder.decode(packet.data, frame);
      if (result instanceof Error) throw result;
      const ratio = result.pixelAspectRatio;
      const displayWidth = ratio.num > ratio.den ? Math.round((result.visibleWidth * ratio.num) / ratio.den) : result.visibleWidth;
      const displayHeight = ratio.num > ratio.den ? result.visibleHeight : Math.round((result.visibleHeight * ratio.den) / ratio.num);
      const colorSpace = {
        primaries: result.colorPrimariesString as VideoColorPrimaries | undefined,
        matrix: result.colorMatrixString as VideoMatrixCoefficients | undefined,
        transfer: result.colorTransferString as VideoTransferCharacteristics | undefined,
        fullRange: result.colorRangeFull,
      };
      const videoFrame = new VideoFrame(result.frameData, {
        format: result.pixelFormat as VideoPixelFormat,
        codedWidth: result.codedWidth,
        codedHeight: result.codedHeight,
        displayWidth,
        displayHeight,
        visibleRect: { x: 0, y: 0, width: result.visibleWidth, height: result.visibleHeight },
        timestamp: packet.microsecondTimestamp,
        duration: packet.microsecondDuration,
        colorSpace,
      });
      if (this.closed) {
        videoFrame.close();
        return;
      }
      this.onSample(new VideoSample(videoFrame, { timestamp: packet.timestamp, duration: packet.duration }));
    } finally {
      frame.clear();
    }
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending;
    const decoder = this.decoder;
    this.decoder = null;
    if (decoder) await decoder.close();
  }
}

let registered = false;

export function registerProresDecoder(): void {
  if (registered) return;
  registered = true;
  registerDecoder(ProresDecoder);
}
