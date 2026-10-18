import { BitWriter, writeCodeword } from './bit-writer';
import { forwardDct } from './dct';
import {
  AC_CODEBOOKS,
  DC_CODEBOOKS,
  DEFAULT_QUANT_MATRIX,
  FIRST_DC_CODEBOOK,
  FRAME_ID,
  LEVEL_TO_CODEBOOK,
  PROFILES,
  PROGRESSIVE_SCAN,
  QUANT_STEPS,
  RUN_TO_CODEBOOK,
  type ProresProfile,
} from './tables';

export interface Planes422 {
  readonly width: number;
  readonly height: number;
  readonly y: Uint16Array;
  readonly cb: Uint16Array;
  readonly cr: Uint16Array;
}

export interface ColorTags {
  readonly primaries: number;
  readonly transfer: number;
  readonly matrix: number;
}

export const REC709: ColorTags = { primaries: 1, transfer: 1, matrix: 1 };

const MB = 16;
const LOG2_SLICE_MBS = 3;
const SLICE_HEADER_BYTES = 6;
const DC_CENTER = 0x4000;
const BORROW_FACTOR = 4;
const VENDOR = [0x6d, 0x6e, 0x74, 0x67];

const sign = (v: number) => (v < 0 ? -1 : 0);
const fold = (v: number) => (v * 2) ^ sign(v);

interface PlaneGeometry {
  readonly blockWidth: number;
  readonly blocksPerMb: number;
}

const LUMA: PlaneGeometry = { blockWidth: 16, blocksPerMb: 4 };
const CHROMA: PlaneGeometry = { blockWidth: 8, blocksPerMb: 2 };

export interface SliceCoder {
  code(planes: Planes422, bitsPerMacroblock: number, quantStart: number): Uint8Array[];
}

export class ProresFrameEncoder {
  private quantStart: number;
  private readonly bitsPerMb: number;

  constructor(
    readonly profile: ProresProfile,
    private colors: ColorTags = REC709,
    private coder: SliceCoder = new ScriptSliceCoder(),
  ) {
    this.bitsPerMb = PROFILES[profile].bitsPerMacroblock;
    this.quantStart = QUANT_STEPS.indexOf(PROFILES[profile].minQuant);
  }

  encode(planes: Planes422): Uint8Array {
    return this.assemble(planes, this.coder.code(planes, this.bitsPerMb, this.quantStart));
  }

  private assemble(planes: Planes422, slices: Uint8Array[]): Uint8Array {
    const frameHeader = 20;
    const pictureHeader = 8;
    const table = slices.length * 2;
    const payload = slices.reduce((n, s) => n + s.length, 0);
    const pictureSize = pictureHeader + table + payload;
    const size = 8 + frameHeader + pictureSize;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    view.setUint32(0, size);
    view.setUint32(4, FRAME_ID);
    let p = 8;
    view.setUint16(p, frameHeader);
    view.setUint16(p + 2, 0);
    out.set(VENDOR, p + 4);
    view.setUint16(p + 8, planes.width);
    view.setUint16(p + 10, planes.height);
    out[p + 12] = 2 << 6;
    out[p + 13] = 0;
    out[p + 14] = this.colors.primaries;
    out[p + 15] = this.colors.transfer;
    out[p + 16] = this.colors.matrix;
    out[p + 17] = 0;
    out[p + 18] = 0;
    out[p + 19] = 0;
    p += frameHeader;
    out[p] = pictureHeader << 3;
    view.setUint32(p + 1, pictureSize);
    view.setUint16(p + 5, slices.length);
    out[p + 7] = LOG2_SLICE_MBS << 4;
    p += pictureHeader;
    slices.forEach((s, i) => view.setUint16(p + i * 2, s.length));
    p += table;
    for (const s of slices) {
      out.set(s, p);
      p += s.length;
    }
    return out;
  }
}

export function searchQuant(start: number, min: number, max: number, fits: (index: number) => boolean): number {
  let index = Math.min(max, Math.max(min, start));
  if (fits(index)) {
    while (index > min && fits(index - 1)) index--;
    return index;
  }
  while (index < max && !fits(++index));
  return index;
}

export const sliceLayout = (mbWidth: number) => {
  const out: { x: number; mbs: number }[] = [];
  let size = 1 << LOG2_SLICE_MBS;
  for (let x = 0; x < mbWidth; x += size) {
    while (mbWidth - x < size) size >>= 1;
    out.push({ x, mbs: size });
  }
  return out;
};

export class ScriptSliceCoder implements SliceCoder {
  private writers = [new BitWriter(), new BitWriter(), new BitWriter()];
  private blocks = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
  private pixels = new Float64Array(64);
  private lastIndex = 0;

  code(planes: Planes422, bitsPerMb: number, quantStart: number): Uint8Array[] {
    this.lastIndex = quantStart;
    const mbWidth = Math.ceil(planes.width / MB);
    const mbHeight = Math.ceil(planes.height / MB);
    const slices = sliceLayout(mbWidth);
    const sliceData: Uint8Array[] = [];
    let remainingMbs = mbWidth * mbHeight;
    let remainingBits = remainingMbs * bitsPerMb;
    for (let row = 0; row < mbHeight; row++) {
      for (const slice of slices) {
        const allowance = Math.min(remainingBits, (remainingBits / remainingMbs) * slice.mbs * BORROW_FACTOR);
        const bytes = this.encodeSlice(planes, slice.x, row, slice.mbs, allowance, quantStart);
        remainingBits -= bytes.length * 8;
        remainingMbs -= slice.mbs;
        sliceData.push(bytes);
      }
    }
    return sliceData;
  }

  private encodeSlice(planes: Planes422, mbX: number, mbY: number, mbs: number, budget: number, quantStart: number): Uint8Array {
    const sources = [
      { data: planes.y, width: planes.width, geometry: LUMA },
      { data: planes.cb, width: planes.width >> 1, geometry: CHROMA },
      { data: planes.cr, width: planes.width >> 1, geometry: CHROMA },
    ];
    sources.forEach((source, i) => this.gather(source.data, source.width, planes.height, source.geometry, mbX, mbY, mbs, i));
    let tried = -1;
    const fits = (index: number) => {
      tried = index;
      let bits = 0;
      sources.forEach((source, i) => {
        this.encodePlane(i, source.geometry.blocksPerMb * mbs, QUANT_STEPS[index]);
        bits += this.writers[i].bitLength;
      });
      return bits <= budget;
    };
    const index = searchQuant(this.lastIndex, quantStart, QUANT_STEPS.length - 1, fits);
    if (tried !== index) fits(index);
    this.lastIndex = index;
    const sizes = this.writers.map((w) => w.byteLength);
    const bytes = new Uint8Array(SLICE_HEADER_BYTES + sizes[0] + sizes[1] + sizes[2]);
    bytes[0] = SLICE_HEADER_BYTES << 3;
    bytes[1] = QUANT_STEPS[index];
    bytes[2] = sizes[0] >> 8;
    bytes[3] = sizes[0] & 0xff;
    bytes[4] = sizes[1] >> 8;
    bytes[5] = sizes[1] & 0xff;
    let offset = SLICE_HEADER_BYTES;
    this.writers.forEach((w, i) => {
      w.copyTo(bytes, offset);
      offset += sizes[i];
    });
    return bytes;
  }

  private gather(data: Uint16Array, width: number, height: number, geometry: PlaneGeometry, mbX: number, mbY: number, mbs: number, plane: number) {
    const count = geometry.blocksPerMb * mbs * 64;
    if (this.blocks[plane].length < count) this.blocks[plane] = new Int32Array(count);
    const out = this.blocks[plane];
    const pixels = this.pixels;
    let block = 0;
    for (let m = 0; m < mbs; m++) {
      const x0 = (mbX + m) * geometry.blockWidth;
      const y0 = mbY * MB;
      const origins = geometry.blocksPerMb === 4 ? [[0, 0], [8, 0], [0, 8], [8, 8]] : [[0, 0], [0, 8]];
      for (const [bx, by] of origins) {
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(height - 1, y0 + by + y) * width;
          for (let x = 0; x < 8; x++) pixels[y * 8 + x] = data[sy + Math.min(width - 1, x0 + bx + x)];
        }
        forwardDct(pixels, out, block * 64);
        block++;
      }
    }
  }

  private encodePlane(plane: number, blockCount: number, quant: number) {
    const writer = this.writers[plane];
    const blocks = this.blocks[plane];
    writer.reset();
    const scale = DEFAULT_QUANT_MATRIX * quant;
    let previous = Math.trunc((blocks[0] - DC_CENTER) / scale);
    writeCodeword(writer, FIRST_DC_CODEBOOK, fold(previous));
    let codebook = 3;
    let lastSign = 0;
    for (let b = 1; b < blockCount; b++) {
      const dc = Math.trunc((blocks[b * 64] - DC_CENTER) / scale);
      let delta = dc - previous;
      const nextSign = sign(delta);
      delta = (delta ^ lastSign) - lastSign;
      const code = fold(delta);
      writeCodeword(writer, DC_CODEBOOKS[codebook], code);
      codebook = Math.min(3, (code + (code & 1)) >> 1);
      lastSign = nextSign;
      previous = dc;
    }
    let runCodebook = RUN_TO_CODEBOOK[4];
    let levelCodebook = LEVEL_TO_CODEBOOK[2];
    let run = 0;
    const total = blockCount * 64;
    for (let i = 1; i < 64; i++) {
      const position = PROGRESSIVE_SCAN[i];
      for (let index = position; index < total; index += 64) {
        const level = Math.trunc(blocks[index] / scale);
        if (!level) {
          run++;
          continue;
        }
        const magnitude = Math.abs(level);
        writeCodeword(writer, AC_CODEBOOKS[runCodebook], run);
        writeCodeword(writer, AC_CODEBOOKS[levelCodebook], magnitude - 1);
        writer.put(1, level < 0 ? 1 : 0);
        runCodebook = RUN_TO_CODEBOOK[Math.min(run, 15)];
        levelCodebook = LEVEL_TO_CODEBOOK[Math.min(magnitude, 9)];
        run = 0;
      }
    }
    writer.align();
  }
}
