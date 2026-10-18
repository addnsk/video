export type Planar = Float32Array[];

export const silence = (channels: number, frames: number): Planar =>
  Array.from({ length: channels }, () => new Float32Array(frames));

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = x - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

export interface Envelope {
  gain(time: number): number;
}

export function mixInto(target: Planar, source: Planar, offset: number, startTime: number, rate: number, envelope: Envelope): void {
  const frames = Math.min(source[0]?.length ?? 0, (target[0]?.length ?? 0) - offset);
  if (frames <= 0) return;
  for (let c = 0; c < target.length; c++) {
    const src = source[Math.min(c, source.length - 1)];
    const dst = target[c];
    for (let i = 0; i < frames; i++) {
      if (offset + i < 0) continue;
      dst[offset + i] += src[i] * envelope.gain(startTime + i / rate);
    }
  }
}

export function addInto(target: Planar, source: Planar): void {
  for (let c = 0; c < target.length; c++) {
    const src = source[Math.min(c, source.length - 1)];
    const dst = target[c];
    const frames = Math.min(dst.length, src.length);
    for (let i = 0; i < frames; i++) dst[i] += src[i];
  }
}
