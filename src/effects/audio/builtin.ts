import { DENOISE } from './denoise';
import { DEESSER, GATE, LIMITER } from './dynamics';
import type { ScalarParamSpec } from '../types';
import { BiquadFilter, biquad, type BiquadShape } from './biquad';
import { numberParam, type AudioEffectDef } from './types';

const db = (name: string, label: string): ScalarParamSpec => ({ name, label, type: 'float', default: 0, min: -18, max: 18, step: 0.5 });

const BANDS: readonly { spec: ScalarParamSpec; shape: BiquadShape; frequency: number; q: number }[] = [
  { spec: db('low', 'Low (120 Hz)'), shape: 'lowshelf', frequency: 120, q: Math.SQRT1_2 },
  { spec: db('mid', 'Mid (1 kHz)'), shape: 'peaking', frequency: 1000, q: 0.9 },
  { spec: db('high', 'High (8 kHz)'), shape: 'highshelf', frequency: 8000, q: Math.SQRT1_2 },
];

export const EQ: AudioEffectDef = {
  kind: 'audio',
  id: 'eq',
  name: 'Equalizer',
  params: BANDS.map((b) => b.spec),
  create(sampleRate, channels) {
    const filters = BANDS.map(() => new BiquadFilter(channels));
    return {
      process(data, params) {
        BANDS.forEach((band, i) => {
          const gain = numberParam(params, band.spec);
          if (gain !== 0) filters[i].process(data, biquad(band.shape, sampleRate, band.frequency, gain, band.q));
        });
      },
    };
  },
};

const CUTOFF: ScalarParamSpec = { name: 'cutoff', label: 'Cutoff (Hz)', type: 'float', default: 80, min: 20, max: 1000, step: 1 };

export const HIGHPASS: AudioEffectDef = {
  kind: 'audio',
  id: 'highpass',
  name: 'Low cut',
  params: [CUTOFF],
  create(sampleRate, channels) {
    const first = new BiquadFilter(channels);
    const second = new BiquadFilter(channels);
    return {
      process(data, params) {
        const c = biquad('highpass', sampleRate, numberParam(params, CUTOFF));
        first.process(data, c);
        second.process(data, c);
      },
    };
  },
};

const THRESHOLD: ScalarParamSpec = { name: 'threshold', label: 'Threshold (dB)', type: 'float', default: -18, min: -48, max: 0, step: 0.5 };
const RATIO: ScalarParamSpec = { name: 'ratio', label: 'Ratio', type: 'float', default: 3, min: 1, max: 20, step: 0.1 };
const MAKEUP: ScalarParamSpec = { name: 'makeup', label: 'Makeup (dB)', type: 'float', default: 0, min: 0, max: 24, step: 0.5 };
const ATTACK_S = 0.005;
const RELEASE_S = 0.12;

export const COMPRESSOR: AudioEffectDef = {
  kind: 'audio',
  id: 'compressor',
  name: 'Compressor',
  params: [THRESHOLD, RATIO, MAKEUP],
  create(sampleRate) {
    const attack = Math.exp(-1 / (ATTACK_S * sampleRate));
    const release = Math.exp(-1 / (RELEASE_S * sampleRate));
    let envelope = 0;
    return {
      process(data, params) {
        const threshold = numberParam(params, THRESHOLD);
        const ratio = Math.max(1, numberParam(params, RATIO));
        const makeup = 10 ** (numberParam(params, MAKEUP) / 20);
        const frames = data[0]?.length ?? 0;
        for (let i = 0; i < frames; i++) {
          let peak = 0;
          for (const ch of data) peak = Math.max(peak, Math.abs(ch[i]));
          envelope = peak > envelope ? attack * envelope + (1 - attack) * peak : release * envelope + (1 - release) * peak;
          const level = 20 * Math.log10(Math.max(envelope, 1e-6));
          const over = level - threshold;
          const gain = (over > 0 ? 10 ** ((-over * (1 - 1 / ratio)) / 20) : 1) * makeup;
          for (const ch of data) ch[i] *= gain;
        }
      },
    };
  },
};

export const AUDIO_EFFECTS: readonly AudioEffectDef[] = [HIGHPASS, DENOISE, GATE, EQ, DEESSER, COMPRESSOR, LIMITER];

export const audioEffect = (id: string): AudioEffectDef | undefined => AUDIO_EFFECTS.find((d) => d.id === id);
