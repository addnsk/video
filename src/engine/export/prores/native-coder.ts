import { forwardDctBasis } from './dct';
import type { Planes422, SliceCoder } from './encoder';

interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly __heap_base: WebAssembly.Global;
  basis_table(): number;
  encode_frame(width: number, height: number, y: number, cb: number, cr: number, bitsPerMb: number, quantStart: number, out: number, capacity: number): number;
}

const PAGE = 65536;
const align = (n: number) => (n + 15) & ~15;

export class NativeSliceCoder implements SliceCoder {
  private readonly base: number;

  constructor(private exports: Exports) {
    this.base = align(exports.__heap_base.value as number);
    new Float64Array(exports.memory.buffer, exports.basis_table(), 64).set(forwardDctBasis);
  }

  code(planes: Planes422, bitsPerMb: number, quantStart: number): Uint8Array[] {
    const { memory, encode_frame } = this.exports;
    const y = this.base;
    const cb = align(y + planes.y.byteLength);
    const cr = align(cb + planes.cb.byteLength);
    const out = align(cr + planes.cr.byteLength);
    const capacity = align(planes.y.byteLength * 4 + 65536);
    const needed = out + capacity;
    if (memory.buffer.byteLength < needed) memory.grow(Math.ceil((needed - memory.buffer.byteLength) / PAGE));
    const heap = memory.buffer;
    new Uint16Array(heap, y, planes.y.length).set(planes.y);
    new Uint16Array(heap, cb, planes.cb.length).set(planes.cb);
    new Uint16Array(heap, cr, planes.cr.length).set(planes.cr);
    const size = encode_frame(planes.width, planes.height, y, cb, cr, bitsPerMb, quantStart, out, capacity);
    if (size < 0) throw new Error(`Native ProRes encoder failed (${size})`);
    const bytes = new Uint8Array(memory.buffer, out, size);
    const count = sliceCount(planes);
    const slices: Uint8Array[] = [];
    let offset = count * 2;
    for (let i = 0; i < count; i++) {
      const length = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      slices.push(bytes.slice(offset, offset + length));
      offset += length;
    }
    return slices;
  }
}

const sliceCount = (planes: Planes422) => {
  const mbWidth = Math.ceil(planes.width / 16);
  return (Math.floor(mbWidth / 8) + popcount(mbWidth % 8)) * Math.ceil(planes.height / 16);
};

const popcount = (n: number) => {
  let c = 0;
  for (let v = n; v; v &= v - 1) c++;
  return c;
};

export async function instantiateNativeCoder(bytes: BufferSource): Promise<NativeSliceCoder> {
  const { instance } = await WebAssembly.instantiate(bytes);
  return new NativeSliceCoder(instance.exports as unknown as Exports);
}

let shared: Promise<NativeSliceCoder | null> | null = null;

export function loadNativeCoder(): Promise<NativeSliceCoder | null> {
  shared ??= fetch(new URL('./prores.wasm', import.meta.url))
    .then((r) => r.arrayBuffer())
    .then(instantiateNativeCoder)
    .catch(() => null);
  return shared;
}
