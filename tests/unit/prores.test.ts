import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, MovOutputFormat, Output } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { BitWriter, writeCodeword } from '../../src/engine/export/prores/bit-writer';
import { rgbaToPlanes422 } from '../../src/engine/export/prores/color';
import { ProresFrameEncoder, type Planes422 } from '../../src/engine/export/prores/encoder';
import { PROFILES, profileForFourCc, type ProresProfile } from '../../src/engine/export/prores/tables';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const pattern = (width: number, height: number): Planes422 => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const bar = Math.floor((x / width) * 8);
      rgba[i] = y < height / 2 ? (bar & 1 ? 235 : 20) : Math.round((x / width) * 255);
      rgba[i + 1] = y < height / 2 ? (bar & 2 ? 235 : 20) : Math.round((y / height) * 255);
      rgba[i + 2] = y < height / 2 ? (bar & 4 ? 235 : 20) : 128 + Math.round(60 * Math.sin(x / 7) * Math.cos(y / 5));
      rgba[i + 3] = 255;
    }
  }
  return rgbaToPlanes422(rgba, width, height);
};

async function toMov(frames: Uint8Array[], profile: ProresProfile, width: number, height: number): Promise<Uint8Array> {
  const output = new Output({ format: new MovOutputFormat(), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource('prores');
  output.addVideoTrack(source, { frameRate: 25 });
  await output.start();
  for (const [i, data] of frames.entries()) {
    await source.add(new EncodedPacket(data, 'key', i / 25, 1 / 25), i === 0 ? { decoderConfig: { codec: PROFILES[profile].fourCc, codedWidth: width, codedHeight: height } } : undefined);
  }
  await output.finalize();
  return new Uint8Array(output.target.buffer!);
}

const psnr = (a: Uint16Array, b: Uint16Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return 10 * Math.log10((1023 * 1023) / (sum / a.length));
};

describe('prores bitstream primitives', () => {
  it('writes bits most significant first and grows', () => {
    const writer = new BitWriter(1);
    writer.put(3, 0b101);
    writer.put(13, 0x1abc);
    writer.put(1, 1);
    writer.align();
    const bytes = new Uint8Array(writer.byteLength);
    writer.copyTo(bytes, 0);
    expect([...bytes]).toEqual([0b10111010, 0b10111100, 0b10000000]);
  });

  it('switches from Rice to exp-Golomb codes', () => {
    const encode = (codebook: number, value: number) => {
      const writer = new BitWriter();
      writeCodeword(writer, codebook, value);
      return writer.bitLength;
    };
    expect(encode(0x04, 0)).toBe(1);
    expect(encode(0x04, 1)).toBe(3);
    expect(encode(0x28, 1)).toBe(2);
    expect(encode(0x28, 2)).toBeGreaterThan(2);
  });

  it('maps fourccs to profiles', () => {
    expect(profileForFourCc('apch')).toBe('hq');
    expect(profileForFourCc('apco')).toBe('proxy');
    expect(profileForFourCc('avc1')).toBeNull();
  });
});

describe.runIf(hasFfmpeg)('prores encoder against ffmpeg', () => {
  for (const profile of ['hq', 'proxy'] as const) {
    it(`decodes ${profile} frames with high fidelity`, async () => {
      const [width, height] = [200, 120];
      const planes = pattern(width, height);
      const encoder = new ProresFrameEncoder(profile);
      const frames = [encoder.encode(planes), encoder.encode(planes)];
      const dir = mkdtempSync(join(tmpdir(), 'prores-'));
      const movie = join(dir, 'out.mov');
      writeFileSync(movie, await toMov(frames, profile, width, height));
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt', '-of', 'json', movie]).toString();
      const stream = JSON.parse(probe).streams[0];
      expect(stream).toMatchObject({ codec_name: 'prores', width, height, pix_fmt: 'yuv422p10le' });
      const raw = join(dir, 'out.yuv');
      execFileSync('ffmpeg', ['-v', 'error', '-i', movie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', raw]);
      const decoded = new Uint16Array(readFileSync(raw).buffer.slice(0));
      const y = decoded.subarray(0, width * height);
      const cb = decoded.subarray(width * height, width * height * 1.5);
      expect(psnr(y, planes.y)).toBeGreaterThan(profile === 'hq' ? 45 : 32);
      expect(psnr(cb, planes.cb)).toBeGreaterThan(profile === 'hq' ? 45 : 32);
    }, 30000);
  }
});
