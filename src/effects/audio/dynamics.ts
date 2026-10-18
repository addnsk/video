import type { ScalarParamSpec } from '../types';
import { BiquadFilter, biquad } from './biquad';
import { InterSamplePeak, PEAK_TAPS } from './oversample';
import { numberParam, type AudioEffectDef } from './types';

const coefficient = (seconds: number, sampleRate: number) => Math.exp(-1 / (Math.max(seconds, 1e-4) * sampleRate));
const toGain = (db: number) => 10 ** (db / 20);

const CEILING: ScalarParamSpec = { name: 'ceiling', label: 'Ceiling (dB)', type: 'float', default: -1, min: -12, max: 0, step: 0.1 };
const LIMIT_RELEASE: ScalarParamSpec = { name: 'release', label: 'Release (ms)', type: 'float', default: 80, min: 5, max: 1000, step: 1 };

export const LIMITER_LOOKAHEAD_S = 0.0015;

const lookaheadFrames = (sampleRate: number) => Math.max(2, Math.round(LIMITER_LOOKAHEAD_S * sampleRate));

export const LIMITER: AudioEffectDef = {
  kind: 'audio',
  id: 'limiter',
  name: 'Limiter',
  params: [CEILING, LIMIT_RELEASE],
  latency: (sampleRate) => lookaheadFrames(sampleRate) - 1 + PEAK_TAPS / 2,
  create(sampleRate, channels) {
    const window = lookaheadFrames(sampleRate);
    const delay = window - 1 + PEAK_TAPS / 2;
    const peaks = new InterSamplePeak(Math.max(1, channels));
    const lines = Array.from({ length: Math.max(1, channels) }, () => new Float64Array(delay + 1));
    const required = new Float64Array(window);
    const smoothed = new Float64Array(window);
    let head = 0;
    let line = 0;
    let held = 1;
    let sum = window;
    smoothed.fill(1);
    required.fill(1);
    return {
      process(data, params) {
        const ceiling = toGain(numberParam(params, CEILING));
        const release = coefficient(numberParam(params, LIMIT_RELEASE) / 1000, sampleRate);
        const frames = data[0]?.length ?? 0;
        for (let i = 0; i < frames; i++) {
          let peak = 0;
          data.forEach((ch, c) => {
            peak = Math.max(peak, peaks.next(c, ch[i]));
            lines[c][line] = ch[i];
          });
          required[head] = peak > ceiling ? ceiling / peak : 1;
          let minimum = 1;
          for (let k = 0; k < window; k++) if (required[k] < minimum) minimum = required[k];
          held = Math.min(minimum, release * held + (1 - release));
          sum += held - smoothed[head];
          smoothed[head] = held;
          head = (head + 1) % window;
          const gain = sum / window;
          const out = (line + 1) % (delay + 1);
          data.forEach((ch, c) => {
            ch[i] = lines[c][out] * gain;
          });
          line = out;
        }
      },
    };
  },
};

const GATE_THRESHOLD: ScalarParamSpec = { name: 'threshold', label: 'Threshold (dB)', type: 'float', default: -45, min: -80, max: 0, step: 0.5 };
const RANGE: ScalarParamSpec = { name: 'range', label: 'Range (dB)', type: 'float', default: -30, min: -80, max: 0, step: 0.5 };
const GATE_ATTACK: ScalarParamSpec = { name: 'attack', label: 'Attack (ms)', type: 'float', default: 2, min: 0.1, max: 100, step: 0.1 };
const HOLD: ScalarParamSpec = { name: 'hold', label: 'Hold (ms)', type: 'float', default: 50, min: 0, max: 1000, step: 1 };
const GATE_RELEASE: ScalarParamSpec = { name: 'release', label: 'Release (ms)', type: 'float', default: 150, min: 5, max: 2000, step: 1 };
const DETECT_S = 0.002;

export const GATE: AudioEffectDef = {
  kind: 'audio',
  id: 'gate',
  name: 'Gate',
  params: [GATE_THRESHOLD, RANGE, GATE_ATTACK, HOLD, GATE_RELEASE],
  create(sampleRate) {
    const detect = coefficient(DETECT_S, sampleRate);
    let level = 0;
    let gain = 1;
    let held = 0;
    return {
      process(data, params) {
        const threshold = toGain(numberParam(params, GATE_THRESHOLD));
        const floor = toGain(numberParam(params, RANGE));
        const attack = coefficient(numberParam(params, GATE_ATTACK) / 1000, sampleRate);
        const release = coefficient(numberParam(params, GATE_RELEASE) / 1000, sampleRate);
        const hold = Math.round((numberParam(params, HOLD) / 1000) * sampleRate);
        const frames = data[0]?.length ?? 0;
        for (let i = 0; i < frames; i++) {
          let peak = 0;
          for (const ch of data) peak = Math.max(peak, Math.abs(ch[i]));
          level = peak > level ? peak : detect * level + (1 - detect) * peak;
          if (level >= threshold) held = hold;
          else if (held > 0) held--;
          const open = level >= threshold || held > 0;
          gain = open ? attack * gain + (1 - attack) : release * gain + (1 - release) * floor;
          for (const ch of data) ch[i] *= gain;
        }
      },
    };
  },
};

const FREQUENCY: ScalarParamSpec = { name: 'frequency', label: 'Frequency (Hz)', type: 'float', default: 6000, min: 2000, max: 12000, step: 10 };
const ESS_THRESHOLD: ScalarParamSpec = { name: 'threshold', label: 'Threshold (dB)', type: 'float', default: -30, min: -60, max: 0, step: 0.5 };
const REDUCTION: ScalarParamSpec = { name: 'reduction', label: 'Max reduction (dB)', type: 'float', default: 12, min: 0, max: 30, step: 0.5 };
const ESS_ATTACK_S = 0.001;
const ESS_RELEASE_S = 0.06;

const CONTROL_BLOCK = 32;

export const DEESSER: AudioEffectDef = {
  kind: 'audio',
  id: 'deesser',
  name: 'De-esser',
  params: [FREQUENCY, ESS_THRESHOLD, REDUCTION],
  create(sampleRate, channels) {
    const detector = [new BiquadFilter(channels), new BiquadFilter(channels)];
    const shelf = new BiquadFilter(channels);
    const attack = coefficient(ESS_ATTACK_S, sampleRate);
    const release = coefficient(ESS_RELEASE_S, sampleRate);
    let envelope = 0;
    let side: Float32Array[] = [];
    return {
      process(data, params) {
        const frames = data[0]?.length ?? 0;
        if (!side.length || side[0].length < frames) side = data.map(() => new Float32Array(frames));
        const bands = data.map((ch, c) => {
          const band = side[c].subarray(0, frames);
          band.set(ch);
          return band;
        });
        const frequency = numberParam(params, FREQUENCY);
        const c = biquad('highpass', sampleRate, frequency);
        detector[0].process(bands, c);
        detector[1].process(bands, c);
        const threshold = numberParam(params, ESS_THRESHOLD);
        const limit = numberParam(params, REDUCTION);
        for (let start = 0; start < frames; start += CONTROL_BLOCK) {
          const end = Math.min(frames, start + CONTROL_BLOCK);
          for (let i = start; i < end; i++) {
            let peak = 0;
            for (const band of bands) peak = Math.max(peak, Math.abs(band[i]));
            envelope = peak > envelope ? attack * envelope + (1 - attack) * peak : release * envelope + (1 - release) * peak;
          }
          const over = 20 * Math.log10(Math.max(envelope, 1e-6)) - threshold;
          const cut = Math.min(limit, Math.max(0, over));
          shelf.process(data.map((ch) => ch.subarray(start, end)), biquad('highshelf', sampleRate, frequency * 0.7, -cut));
        }
      },
    };
  },
};
