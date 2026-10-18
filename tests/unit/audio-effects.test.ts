import { describe, expect, it } from 'vitest';
import { BiquadFilter, biquad, magnitudeAt } from '../../src/effects/audio/biquad';
import { AUDIO_EFFECTS, COMPRESSOR, EQ, HIGHPASS, audioEffect } from '../../src/effects/audio/builtin';

const RATE = 48000;
const sine = (frequency: number, seconds = 0.5, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE));
const peak = (data: Float32Array, from = 0.25) => data.subarray(Math.round(data.length * from)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const toDb = (v: number) => 20 * Math.log10(v);

describe('biquad', () => {
  it('matches the cookbook responses', () => {
    expect(toDb(magnitudeAt(biquad('peaking', RATE, 1000, 6, 0.9), 1000, RATE))).toBeCloseTo(6, 1);
    expect(toDb(magnitudeAt(biquad('lowshelf', RATE, 120, -9), 10, RATE))).toBeCloseTo(-9, 0);
    expect(toDb(magnitudeAt(biquad('highshelf', RATE, 8000, 12), 20000, RATE))).toBeCloseTo(12, 0);
    expect(magnitudeAt(biquad('highpass', RATE, 200), 20, RATE)).toBeLessThan(0.02);
    expect(magnitudeAt(biquad('lowpass', RATE, 200), 20, RATE)).toBeCloseTo(1, 2);
  });

  it('keeps state across chunks', () => {
    const coefficients = biquad('peaking', RATE, 1000, 9, 0.9);
    const whole = sine(700);
    const chunked = whole.slice();
    new BiquadFilter(1).process([whole], coefficients);
    const filter = new BiquadFilter(1);
    for (let i = 0; i < chunked.length; i += 333) filter.process([chunked.subarray(i, i + 333)], coefficients);
    expect(Array.from(chunked)).toEqual(Array.from(whole));
  });
});

describe('audio effects', () => {
  it('registers ids and lookups', () => {
    expect(AUDIO_EFFECTS.map((d) => d.id)).toEqual(['highpass', 'denoise', 'gate', 'eq', 'deesser', 'compressor', 'limiter']);
    expect(audioEffect('eq')).toBe(EQ);
    expect(audioEffect('grade')).toBeUndefined();
  });

  it('boosts the mid band and leaves flat settings untouched', () => {
    const boosted = sine(1000);
    EQ.create(RATE, 1).process([boosted], { mid: 6 });
    expect(toDb(peak(boosted) / 0.5)).toBeCloseTo(6, 0);
    const flat = sine(1000);
    EQ.create(RATE, 1).process([flat], {});
    expect(Array.from(flat)).toEqual(Array.from(sine(1000)));
  });

  it('cuts rumble below the cutoff', () => {
    const low = sine(30);
    const voice = sine(1000);
    const processor = HIGHPASS.create(RATE, 2);
    processor.process([low, voice], { cutoff: 150 });
    expect(peak(low)).toBeLessThan(0.05);
    expect(peak(voice)).toBeGreaterThan(0.48);
  });

  it('compresses loud signals and leaves quiet ones', () => {
    const loud = sine(440, 0.5, 0.9);
    const quiet = sine(440, 0.5, 0.01);
    COMPRESSOR.create(RATE, 1).process([loud], { threshold: -20, ratio: 4 });
    COMPRESSOR.create(RATE, 1).process([quiet], { threshold: -20, ratio: 4 });
    expect(peak(loud)).toBeLessThan(0.4);
    expect(peak(quiet)).toBeCloseTo(0.01, 3);
  });
});
