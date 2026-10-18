import { OUTSIDE, type LumaFrame, type Scorer, type Template } from './tracker';

interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly __heap_base: WebAssembly.Global;
  match_scores(frame: number, width: number, height: number, template: number, size: number, norm: number, left: number, top: number, span: number, scores: number): void;
}

const PAGE = 65536;
const align = (n: number) => (n + 15) & ~15;

export class NativeScorer implements Scorer {
  private readonly base: number;

  constructor(private exports: Exports) {
    this.base = align(exports.__heap_base.value as number);
  }

  scores(frame: LumaFrame, template: Template, left: number, top: number, span: number): Float32Array {
    const { memory, match_scores } = this.exports;
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    const width = Math.max(0, Math.min(frame.width, left + span + template.size) - x0);
    const height = Math.max(0, Math.min(frame.height, top + span + template.size) - y0);
    const framePtr = this.base;
    const templatePtr = align(framePtr + width * height * 4);
    const scoresPtr = align(templatePtr + template.values.byteLength);
    const needed = scoresPtr + span * span * 4;
    if (memory.buffer.byteLength < needed) memory.grow(Math.ceil((needed - memory.buffer.byteLength) / PAGE));
    const region = new Float32Array(memory.buffer, framePtr, width * height);
    for (let y = 0; y < height; y++) region.set(frame.data.subarray((y0 + y) * frame.width + x0, (y0 + y) * frame.width + x0 + width), y * width);
    new Float32Array(memory.buffer, templatePtr, template.values.length).set(template.values);
    match_scores(framePtr, width, height, templatePtr, template.size, template.norm, left - x0, top - y0, span, scoresPtr);
    const out = new Float32Array(memory.buffer, scoresPtr, span * span).slice();
    for (let i = 0; i < out.length; i++) if (out[i] < -1.5) out[i] = OUTSIDE;
    return out;
  }
}

export async function instantiateNativeScorer(bytes: BufferSource): Promise<NativeScorer> {
  const { instance } = await WebAssembly.instantiate(bytes);
  return new NativeScorer(instance.exports as unknown as Exports);
}

let shared: Promise<NativeScorer | null> | null = null;

export function loadNativeScorer(): Promise<NativeScorer | null> {
  shared ??= fetch(new URL('./matcher.wasm', import.meta.url))
    .then((r) => r.arrayBuffer())
    .then(instantiateNativeScorer)
    .catch(() => null);
  return shared;
}
