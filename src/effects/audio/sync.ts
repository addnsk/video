import { Fft } from './fft';

export interface Alignment {
  readonly offset: number;
  readonly confidence: number;
}

function onsets(envelope: Float32Array): Float64Array {
  const out = new Float64Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) out[i] = Math.max(0, Math.sqrt(envelope[i]) - Math.sqrt(envelope[i - 1]));
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  let energy = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    energy += out[i] * out[i];
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy / out.length) : 0;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

export function alignEnvelopes(reference: Float32Array, other: Float32Array, rate: number, minOverlap = 0.25): Alignment {
  const a = onsets(reference);
  const b = onsets(other);
  if (!a.length || !b.length) return { offset: 0, confidence: 0 };
  let size = 1;
  while (size < a.length + b.length) size <<= 1;
  const fft = new Fft(size);
  const ar = new Float64Array(size);
  const ai = new Float64Array(size);
  const br = new Float64Array(size);
  const bi = new Float64Array(size);
  ar.set(a);
  br.set(b);
  fft.transform(ar, ai);
  fft.transform(br, bi);
  for (let i = 0; i < size; i++) {
    const re = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = re;
    ai[i] = im;
  }
  fft.transform(ar, ai, true);
  const shortest = Math.min(a.length, b.length);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag++) {
    const overlap = Math.min(a.length, lag + b.length) - Math.max(0, lag);
    if (overlap < shortest * minOverlap) continue;
    const score = ar[(lag + size) % size] / overlap;
    if (score > bestScore) [bestScore, best] = [score, lag];
  }
  return { offset: best / rate, confidence: Math.max(0, Math.min(1, bestScore)) };
}
