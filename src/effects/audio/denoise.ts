import type { ScalarParamSpec } from '../types';
import { Fft } from './fft';
import { numberParam, type AudioEffectDef } from './types';

export const DENOISE_SIZE = 1024;
const HOP = DENOISE_SIZE / 4;
const BINS = DENOISE_SIZE / 2 + 1;
const NOISE_RISE_DB_PER_S = 10;
const SMOOTH = 0.6;
const POWER_SMOOTH = 0.8;
const LEARN_BLOCKS = 8;
const MINIMUM_BIAS = 2;

const AMOUNT: ScalarParamSpec = { name: 'reduction', label: 'Reduction (dB)', type: 'float', default: 12, min: 0, max: 40, step: 0.5 };
const SENSITIVITY: ScalarParamSpec = { name: 'sensitivity', label: 'Sensitivity', type: 'float', default: 2, min: 0.5, max: 6, step: 0.1 };

const WINDOW = Float64Array.from({ length: DENOISE_SIZE }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / DENOISE_SIZE)));
const OVERLAP_GAIN = DENOISE_SIZE / HOP / 2;

class ChannelState {
  readonly input = new Float64Array(DENOISE_SIZE);
  readonly output = new Float64Array(DENOISE_SIZE);
  readonly ready = new Float64Array(HOP);
  readonly smoothed = new Float64Array(BINS);
  readonly noise = new Float64Array(BINS);
  readonly gains = new Float64Array(BINS).fill(1);
  filled = DENOISE_SIZE - HOP;
  frames = 0;
}

export const DENOISE: AudioEffectDef = {
  kind: 'audio',
  id: 'denoise',
  name: 'Noise reduction',
  params: [AMOUNT, SENSITIVITY],
  latency: () => DENOISE_SIZE,
  create(sampleRate, channels) {
    const fft = new Fft(DENOISE_SIZE);
    const re = new Float64Array(DENOISE_SIZE);
    const im = new Float64Array(DENOISE_SIZE);
    const states = Array.from({ length: Math.max(1, channels) }, () => new ChannelState());
    const rise = 10 ** ((NOISE_RISE_DB_PER_S / 10) * (HOP / sampleRate));
    const block = (state: ChannelState, floor: number, sensitivity: number) => {
      for (let i = 0; i < DENOISE_SIZE; i++) {
        re[i] = state.input[i] * WINDOW[i];
        im[i] = 0;
      }
      fft.transform(re, im);
      for (let k = 0; k < BINS; k++) {
        const power = re[k] * re[k] + im[k] * im[k];
        const smoothed = (state.smoothed[k] = state.frames ? POWER_SMOOTH * state.smoothed[k] + (1 - POWER_SMOOTH) * power : power);
        const noise = state.frames < LEARN_BLOCKS ? (state.frames ? Math.min(state.noise[k], smoothed) : smoothed) : Math.min(smoothed, state.noise[k] * rise);
        state.noise[k] = Math.max(noise, 1e-12);
        const ratio = smoothed > 0 ? (MINIMUM_BIAS * sensitivity * state.noise[k]) / smoothed : 1;
        const target = Math.max(floor, 1 - ratio);
        const gain = SMOOTH * state.gains[k] + (1 - SMOOTH) * target;
        state.gains[k] = gain;
        re[k] *= gain;
        im[k] *= gain;
        if (k > 0 && k < DENOISE_SIZE / 2) {
          re[DENOISE_SIZE - k] *= gain;
          im[DENOISE_SIZE - k] *= gain;
        }
      }
      state.frames++;
      fft.transform(re, im, true);
      for (let i = 0; i < DENOISE_SIZE; i++) state.output[i] += (re[i] * WINDOW[i]) / OVERLAP_GAIN;
    };
    return {
      process(data, params) {
        const floor = 10 ** (-numberParam(params, AMOUNT) / 20);
        const sensitivity = numberParam(params, SENSITIVITY);
        data.forEach((samples, c) => {
          const state = states[Math.min(c, states.length - 1)];
          for (let i = 0; i < samples.length; i++) {
            state.input[state.filled] = samples[i];
            samples[i] = state.ready[state.filled - (DENOISE_SIZE - HOP)];
            state.filled++;
            if (state.filled === DENOISE_SIZE) {
              block(state, floor, sensitivity);
              state.ready.set(state.output.subarray(0, HOP));
              state.input.copyWithin(0, HOP);
              state.output.copyWithin(0, HOP);
              state.output.fill(0, DENOISE_SIZE - HOP);
              state.filled = DENOISE_SIZE - HOP;
            }
          }
        });
      },
    };
  },
};
