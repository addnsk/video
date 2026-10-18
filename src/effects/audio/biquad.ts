export type BiquadShape = 'lowshelf' | 'highshelf' | 'peaking' | 'highpass' | 'lowpass';

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export function biquad(shape: BiquadShape, sampleRate: number, frequency: number, gainDb = 0, q = Math.SQRT1_2): BiquadCoefficients {
  const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const a = 10 ** (gainDb / 40);
  const alpha = sin / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (shape) {
    case 'peaking':
      [b0, b1, b2] = [1 + alpha * a, -2 * cos, 1 - alpha * a];
      [a0, a1, a2] = [1 + alpha / a, -2 * cos, 1 - alpha / a];
      break;
    case 'lowshelf':
    case 'highshelf': {
      const sign = shape === 'lowshelf' ? 1 : -1;
      const root = 2 * Math.sqrt(a) * alpha;
      b0 = a * (a + 1 - sign * (a - 1) * cos + root);
      b1 = sign * 2 * a * (a - 1 - sign * (a + 1) * cos);
      b2 = a * (a + 1 - sign * (a - 1) * cos - root);
      a0 = a + 1 + sign * (a - 1) * cos + root;
      a1 = -sign * 2 * (a - 1 + sign * (a + 1) * cos);
      a2 = a + 1 + sign * (a - 1) * cos - root;
      break;
    }
    case 'highpass':
      [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
      break;
    case 'lowpass':
      [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export class BiquadFilter {
  private state: Float64Array;

  constructor(channels: number) {
    this.state = new Float64Array(channels * 4);
  }

  process(channels: readonly Float32Array[], c: BiquadCoefficients): void {
    channels.forEach((data, ch) => {
      const s = ch * 4;
      let [x1, x2, y1, y2] = [this.state[s], this.state[s + 1], this.state[s + 2], this.state[s + 3]];
      for (let i = 0; i < data.length; i++) {
        const x = data[i];
        const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        [x2, x1, y2, y1] = [x1, x, y1, y];
        data[i] = y;
      }
      this.state.set([x1, x2, y1, y2], s);
    });
  }
}

export function magnitudeAt(c: BiquadCoefficients, frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const re = (k: number) => Math.cos(k * w);
  const im = (k: number) => -Math.sin(k * w);
  const numRe = c.b0 + c.b1 * re(1) + c.b2 * re(2);
  const numIm = c.b1 * im(1) + c.b2 * im(2);
  const denRe = 1 + c.a1 * re(1) + c.a2 * re(2);
  const denIm = c.a1 * im(1) + c.a2 * im(2);
  return Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
}
