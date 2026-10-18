import type { ScalarParamSpec } from '../types';
import { numberParam, type AudioEffectDef } from './types';

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;
const REFERENCE_RATE = 44100;
const INPUT_GAIN = 0.015;

const SIZE: ScalarParamSpec = { name: 'size', label: 'Room size', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 };
const DAMPING: ScalarParamSpec = { name: 'damping', label: 'Damping', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 };
const WIDTH: ScalarParamSpec = { name: 'width', label: 'Width', type: 'float', default: 1, min: 0, max: 1, step: 0.01 };
const PREDELAY: ScalarParamSpec = { name: 'predelay', label: 'Pre-delay (ms)', type: 'float', default: 10, min: 0, max: 200, step: 1 };
const MIX: ScalarParamSpec = { name: 'mix', label: 'Wet (%)', type: 'float', default: 25, min: 0, max: 100, step: 1 };

class Comb {
  private buffer: Float64Array;
  private index = 0;
  private store = 0;

  constructor(length: number) {
    this.buffer = new Float64Array(length);
  }

  next(input: number, feedback: number, damp: number): number {
    const output = this.buffer[this.index];
    this.store = output * (1 - damp) + this.store * damp;
    this.buffer[this.index] = input + this.store * feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return output;
  }
}

class Allpass {
  private buffer: Float64Array;
  private index = 0;

  constructor(length: number) {
    this.buffer = new Float64Array(length);
  }

  next(input: number): number {
    const delayed = this.buffer[this.index];
    this.buffer[this.index] = input + delayed * 0.5;
    this.index = (this.index + 1) % this.buffer.length;
    return delayed - input;
  }
}

class DelayLine {
  private buffer: Float64Array;
  private index = 0;

  constructor(maxFrames: number) {
    this.buffer = new Float64Array(Math.max(1, maxFrames + 1));
  }

  next(input: number, frames: number): number {
    const length = this.buffer.length;
    this.buffer[this.index] = input;
    const read = (this.index - Math.min(length - 1, Math.max(0, frames)) + length) % length;
    this.index = (this.index + 1) % length;
    return this.buffer[read];
  }

  read(frames: number): number {
    const length = this.buffer.length;
    return this.buffer[(this.index - 1 - Math.min(length - 1, Math.max(0, frames)) + 2 * length) % length];
  }

  write(input: number): void {
    this.buffer[this.index] = input;
    this.index = (this.index + 1) % this.buffer.length;
  }
}

const scaled = (frames: number, sampleRate: number) => Math.max(1, Math.round((frames * sampleRate) / REFERENCE_RATE));

export const REVERB: AudioEffectDef = {
  kind: 'audio',
  id: 'reverb',
  name: 'Reverb',
  params: [SIZE, DAMPING, WIDTH, PREDELAY, MIX],
  tail: (params) => 0.5 + 6 * numberParam(params, SIZE) + numberParam(params, PREDELAY) / 1000,
  create(sampleRate) {
    const sides = [0, SPREAD].map((offset) => ({
      combs: COMBS.map((n) => new Comb(scaled(n + offset, sampleRate))),
      allpasses: ALLPASSES.map((n) => new Allpass(scaled(n + offset, sampleRate))),
    }));
    const predelay = new DelayLine(Math.round(0.2 * sampleRate));
    return {
      process(data, params) {
        const feedback = 0.7 + 0.28 * numberParam(params, SIZE);
        const damp = 0.4 * numberParam(params, DAMPING);
        const width = numberParam(params, WIDTH);
        const wet = numberParam(params, MIX) / 100;
        const dry = 1 - wet;
        const delayFrames = Math.round((numberParam(params, PREDELAY) / 1000) * sampleRate);
        const left = data[0];
        const right = data[1] ?? data[0];
        const frames = left?.length ?? 0;
        const wet1 = (wet * (width / 2 + 0.5)) * 3;
        const wet2 = (wet * ((1 - width) / 2)) * 3;
        for (let i = 0; i < frames; i++) {
          const input = predelay.next((left[i] + right[i]) * INPUT_GAIN, delayFrames);
          const outs = sides.map(({ combs, allpasses }) => {
            let sum = 0;
            for (const comb of combs) sum += comb.next(input, feedback, damp);
            for (const allpass of allpasses) sum = allpass.next(sum);
            return sum;
          });
          const l = left[i];
          const r = right[i];
          left[i] = l * dry + outs[0] * wet1 + outs[1] * wet2;
          if (data[1]) right[i] = r * dry + outs[1] * wet1 + outs[0] * wet2;
        }
      },
    };
  },
};

const TIME: ScalarParamSpec = { name: 'time', label: 'Time (ms)', type: 'float', default: 350, min: 1, max: 2000, step: 1 };
const FEEDBACK: ScalarParamSpec = { name: 'feedback', label: 'Feedback (%)', type: 'float', default: 35, min: 0, max: 95, step: 1 };
const PINGPONG: ScalarParamSpec = { name: 'pingpong', label: 'Ping-pong', type: 'float', default: 0, min: 0, max: 1, step: 1 };
const ECHO_MIX: ScalarParamSpec = { name: 'mix', label: 'Wet (%)', type: 'float', default: 30, min: 0, max: 100, step: 1 };
const MAX_DELAY_S = 2;
const SILENT_DB = -60;

export const DELAY: AudioEffectDef = {
  kind: 'audio',
  id: 'delay',
  name: 'Delay',
  params: [TIME, FEEDBACK, PINGPONG, ECHO_MIX],
  tail: (params) => {
    const time = numberParam(params, TIME) / 1000;
    const feedback = numberParam(params, FEEDBACK) / 100;
    return feedback > 0 ? time * Math.ceil(SILENT_DB / (20 * Math.log10(feedback)) + 1) : time;
  },
  create(sampleRate, channels) {
    const lines = Array.from({ length: Math.max(1, channels) }, () => new DelayLine(Math.round(MAX_DELAY_S * sampleRate)));
    return {
      process(data, params) {
        const frames = Math.round((numberParam(params, TIME) / 1000) * sampleRate);
        const feedback = numberParam(params, FEEDBACK) / 100;
        const pingpong = numberParam(params, PINGPONG) >= 0.5 && data.length === 2;
        const wet = numberParam(params, ECHO_MIX) / 100;
        const length = data[0]?.length ?? 0;
        for (let i = 0; i < length; i++) {
          const echoes = lines.map((line) => line.read(frames - 1));
          data.forEach((ch, c) => {
            const input = ch[i];
            const back = pingpong ? echoes[1 - c] : echoes[c];
            lines[c].write(input + back * feedback);
            ch[i] = input * (1 - wet) + echoes[c] * wet;
          });
        }
      },
    };
  },
};
