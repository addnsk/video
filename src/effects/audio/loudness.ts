import { BiquadFilter, type BiquadCoefficients } from './biquad';

const BLOCK_S = 0.4;
const SHORT_S = 3;
const STEP_S = 0.1;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const OFFSET = -0.691;

export interface LoudnessReading {
  readonly momentary: number;
  readonly shortTerm: number;
  readonly integrated: number;
  readonly range: number;
  readonly peak: number;
  readonly truePeak: number;
}

const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12;

const PHASES: readonly Float64Array[] = Array.from({ length: OVERSAMPLE }, (_, phase) => {
  const taps = new Float64Array(TAPS_PER_PHASE);
  const length = TAPS_PER_PHASE * OVERSAMPLE;
  for (let k = 0; k < TAPS_PER_PHASE; k++) {
    const n = k * OVERSAMPLE + phase;
    const x = (n - (length - 1) / 2) / OVERSAMPLE;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length);
    taps[k] = sinc * window;
  }
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((v) => v / sum);
});

class TruePeak {
  private history: Float64Array[];
  private index = 0;
  value = 0;

  constructor(channels: number) {
    this.history = Array.from({ length: channels }, () => new Float64Array(TAPS_PER_PHASE));
  }

  push(planar: readonly Float32Array[]): void {
    const frames = planar[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      this.history.forEach((h, c) => {
        h[this.index] = planar[Math.min(c, planar.length - 1)][i];
        for (const taps of PHASES) {
          let sum = 0;
          for (let k = 0; k < TAPS_PER_PHASE; k++) sum += taps[k] * h[(this.index - k + TAPS_PER_PHASE) % TAPS_PER_PHASE];
          const magnitude = Math.abs(sum);
          if (magnitude > this.value) this.value = magnitude;
        }
      });
      this.index = (this.index + 1) % TAPS_PER_PHASE;
    }
  }
}

const lufs = (power: number) => (power > 0 ? OFFSET + 10 * Math.log10(power) : -Infinity);

export const kWeighting = (sampleRate: number): BiquadCoefficients[] => {
  const shelf = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelf / shelfQ + shelf * shelf;
  const pass = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const passQ = 0.5003270373238773;
  const passA0 = 1 + pass / passQ + pass * pass;
  return [
    {
      b0: (vh + (vb * shelf) / shelfQ + shelf * shelf) / shelfA0,
      b1: (2 * (shelf * shelf - vh)) / shelfA0,
      b2: (vh - (vb * shelf) / shelfQ + shelf * shelf) / shelfA0,
      a1: (2 * (shelf * shelf - 1)) / shelfA0,
      a2: (1 - shelf / shelfQ + shelf * shelf) / shelfA0,
    },
    { b0: 1, b1: -2, b2: 1, a1: (2 * (pass * pass - 1)) / passA0, a2: (1 - pass / passQ + pass * pass) / passA0 },
  ];
};

export class LoudnessMeter {
  private readonly stages: BiquadCoefficients[];
  private readonly filters: BiquadFilter[];
  private readonly step: number;
  private readonly steps: Float64Array;
  private stepIndex = 0;
  private acc = 0;
  private accFrames = 0;
  private blocks: number[] = [];
  private shortBlocks: number[] = [];
  private peakValue = 0;
  private scratch: Float32Array[] = [];
  private truePeakMeter: TruePeak;

  constructor(
    private sampleRate: number,
    private channels = 2,
  ) {
    this.stages = kWeighting(sampleRate);
    this.filters = this.stages.map(() => new BiquadFilter(channels));
    this.step = Math.round(sampleRate * STEP_S);
    this.steps = new Float64Array(Math.round(SHORT_S / STEP_S));
    this.truePeakMeter = new TruePeak(channels);
  }

  push(planar: readonly Float32Array[]): void {
    const frames = planar[0]?.length ?? 0;
    if (!frames) return;
    if (!this.scratch.length || this.scratch[0].length < frames) this.scratch = Array.from({ length: this.channels }, () => new Float32Array(frames));
    const weighted = this.scratch.map((s, c) => {
      const view = s.subarray(0, frames);
      view.set(planar[Math.min(c, planar.length - 1)]);
      return view;
    });
    for (const ch of planar) for (let i = 0; i < frames; i++) this.peakValue = Math.max(this.peakValue, Math.abs(ch[i]));
    this.truePeakMeter.push(planar);
    this.stages.forEach((c, i) => this.filters[i].process(weighted, c));
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const ch of weighted) sum += ch[i] * ch[i];
      this.acc += sum;
      if (++this.accFrames === this.step) this.closeStep();
    }
  }

  private closeStep() {
    this.steps[this.stepIndex % this.steps.length] = this.acc / this.step;
    this.stepIndex++;
    this.acc = 0;
    this.accFrames = 0;
    const perBlock = Math.round(BLOCK_S / STEP_S);
    if (this.stepIndex >= perBlock) this.blocks.push(this.mean(perBlock));
    if (this.stepIndex >= this.steps.length && this.stepIndex % perBlock === 0) this.shortBlocks.push(this.mean(this.steps.length));
  }

  private mean(count: number): number {
    const available = Math.min(count, this.stepIndex);
    let sum = 0;
    for (let i = 1; i <= available; i++) sum += this.steps[(this.stepIndex - i) % this.steps.length];
    return available ? sum / available : 0;
  }

  reading(): LoudnessReading {
    return {
      momentary: lufs(this.mean(Math.round(BLOCK_S / STEP_S))),
      shortTerm: lufs(this.mean(this.steps.length)),
      integrated: integrate(this.blocks),
      range: loudnessRange(this.shortBlocks),
      peak: this.peakValue > 0 ? 20 * Math.log10(this.peakValue) : -Infinity,
      truePeak: Math.max(this.peakValue, this.truePeakMeter.value) > 0 ? 20 * Math.log10(Math.max(this.peakValue, this.truePeakMeter.value)) : -Infinity,
    };
  }
}

function integrate(blocks: readonly number[]): number {
  const absolute = blocks.filter((p) => lufs(p) > ABSOLUTE_GATE);
  if (!absolute.length) return -Infinity;
  const threshold = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) + RELATIVE_GATE;
  const relative = absolute.filter((p) => lufs(p) > threshold);
  return relative.length ? lufs(relative.reduce((a, b) => a + b, 0) / relative.length) : -Infinity;
}

function loudnessRange(blocks: readonly number[]): number {
  const absolute = blocks.filter((p) => lufs(p) > ABSOLUTE_GATE);
  if (absolute.length < 2) return 0;
  const threshold = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 20;
  const values = absolute.map(lufs).filter((v) => v > threshold).sort((a, b) => a - b);
  if (values.length < 2) return 0;
  const at = (q: number) => values[Math.min(values.length - 1, Math.round(q * (values.length - 1)))];
  return at(0.95) - at(0.1);
}

export const LOUDNESS_TARGETS = {
  youtube: { integrated: -14, peak: -1 },
  spotify: { integrated: -14, peak: -1 },
  apple: { integrated: -16, peak: -1 },
  podcast: { integrated: -16, peak: -1 },
  ebu: { integrated: -23, peak: -1 },
  atsc: { integrated: -24, peak: -2 },
} as const;

export type LoudnessTarget = keyof typeof LOUDNESS_TARGETS;
