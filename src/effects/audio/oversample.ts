const OVERSAMPLE = 4;
export const PEAK_TAPS = 12;

const PHASES: readonly Float64Array[] = Array.from({ length: OVERSAMPLE }, (_, phase) => {
  const taps = new Float64Array(PEAK_TAPS);
  const length = PEAK_TAPS * OVERSAMPLE;
  for (let k = 0; k < PEAK_TAPS; k++) {
    const n = k * OVERSAMPLE + phase;
    const x = (n - (length - 1) / 2) / OVERSAMPLE;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length);
    taps[k] = sinc * window;
  }
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((v) => v / sum);
});

export class InterSamplePeak {
  private history: Float64Array[];
  private index: number[];

  constructor(channels: number) {
    this.history = Array.from({ length: channels }, () => new Float64Array(PEAK_TAPS));
    this.index = Array.from({ length: channels }, () => 0);
  }

  next(channel: number, value: number): number {
    const h = this.history[channel];
    const at = this.index[channel];
    h[at] = value;
    this.index[channel] = (at + 1) % PEAK_TAPS;
    let peak = Math.abs(value);
    for (const taps of PHASES) {
      let sum = 0;
      for (let k = 0; k < PEAK_TAPS; k++) sum += taps[k] * h[(at - k + PEAK_TAPS) % PEAK_TAPS];
      const magnitude = Math.abs(sum);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }
}
