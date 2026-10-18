import { describe, expect, it } from 'vitest';
import { DENOISE, DENOISE_SIZE } from '../../src/effects/audio/denoise';
import { DEESSER, GATE, LIMITER } from '../../src/effects/audio/dynamics';
import { DELAY, REVERB } from '../../src/effects/audio/space';
import { Fft } from '../../src/effects/audio/fft';
import { LoudnessMeter } from '../../src/effects/audio/loudness';

const RATE = 48000;
const sine = (frequency: number, seconds: number, amplitude: number) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE));
const noise = (seconds: number, amplitude: number, seed = 1) => {
  let s = seed;
  return Float32Array.from({ length: Math.round(RATE * seconds) }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return amplitude * (s / 2 ** 31 - 1);
  });
};
const rms = (data: Float32Array, from = 0, to = data.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
const db = (v: number) => 20 * Math.log10(v);
const chunked = (data: Float32Array[], size: number, run: (chunk: Float32Array[]) => void) => {
  for (let i = 0; i < data[0].length; i += size) run(data.map((d) => d.subarray(i, i + size)));
};

describe('fft', () => {
  it('round-trips and finds a tone in its bin', () => {
    const fft = new Fft(64);
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / 64));
    const im = new Float64Array(64);
    const original = re.slice();
    fft.transform(re, im);
    expect(Math.hypot(re[5], im[5])).toBeCloseTo(32, 6);
    expect(Math.hypot(re[6], im[6])).toBeCloseTo(0, 6);
    fft.transform(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(original[i], 9);
  });
});

describe('loudness meter', () => {
  it('reads a stereo 1 kHz tone at -23 dBFS as -23 LUFS', () => {
    const meter = new LoudnessMeter(RATE);
    const tone = sine(1000, 6, 10 ** (-23 / 20));
    chunked([tone, tone], 4096, (c) => meter.push(c));
    const reading = meter.reading();
    expect(reading.integrated).toBeCloseTo(-23, 1);
    expect(reading.shortTerm).toBeCloseTo(-23, 1);
    expect(reading.momentary).toBeCloseTo(-23, 1);
    expect(reading.peak).toBeCloseTo(-23, 1);
    expect(reading.range).toBeLessThan(0.5);
  });

  it('gates silence out of the integrated value and reports the range', () => {
    const meter = new LoudnessMeter(RATE);
    const parts = [sine(1000, 4, 10 ** (-20 / 20)), new Float32Array(RATE * 10), sine(1000, 4, 10 ** (-30 / 20))];
    for (const p of parts) chunked([p, p], 1000, (c) => meter.push(c));
    const { integrated, range } = meter.reading();
    expect(integrated).toBeGreaterThan(-24);
    expect(integrated).toBeLessThan(-20);
    expect(range).toBeGreaterThan(8);
  });
});

describe('dynamics', () => {
  it('limiter holds the true peak under the ceiling and delays by its look-ahead', () => {
    const p = LIMITER.create(RATE, 2);
    const l = Float32Array.from({ length: RATE }, (_, i) => 1.8 * Math.sin((2 * Math.PI * 11000 * i) / RATE + 0.7) * (i % 9000 < 300 ? 1 : 0.2));
    const r = noise(1, 2);
    chunked([l, r], 480, (c) => p.process(c, { ceiling: -1 }));
    const meter = new LoudnessMeter(RATE);
    meter.push([l.subarray(4800), r.subarray(4800)]);
    expect(meter.reading().truePeak).toBeLessThan(-0.85);
    const latency = LIMITER.latency!(RATE);
    const quiet = sine(200, 0.5, 0.1);
    const out = quiet.slice();
    LIMITER.create(RATE, 1).process([out], { ceiling: -1 });
    for (let i = latency; i < out.length; i += 101) expect(out[i]).toBeCloseTo(quiet[i - latency], 5);
  });

  it('gate closes on low noise and opens on speech-level signal', () => {
    const p = GATE.create(RATE, 1);
    const signal = new Float32Array(RATE * 2);
    signal.set(noise(1, 0.002), 0);
    signal.set(sine(300, 1, 0.3), RATE);
    p.process([signal], { threshold: -40, range: -40 });
    expect(db(rms(signal, RATE * 0.8, RATE)) - db(0.002 / Math.sqrt(3))).toBeLessThan(-35);
    expect(rms(signal, RATE + RATE / 2, RATE * 2)).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });

  it('de-esser cuts loud sibilance and leaves the voice band alone', () => {
    const hiss = sine(7000, 1, 0.5);
    const voice = sine(300, 1, 0.5);
    DEESSER.create(RATE, 1).process([hiss], { threshold: -30, reduction: 12 });
    DEESSER.create(RATE, 1).process([voice], { threshold: -30, reduction: 12 });
    expect(db(rms(hiss, RATE / 2)) - db(0.5 / Math.SQRT2)).toBeLessThan(-8);
    expect(Math.abs(db(rms(voice, RATE / 2)) - db(0.5 / Math.SQRT2))).toBeLessThan(0.5);
  });
});

describe('noise reduction', () => {
  it('is transparent at zero reduction apart from its latency', () => {
    const p = DENOISE.create(RATE, 1);
    const input = noise(0.5, 0.5, 7);
    const output = input.slice();
    chunked([output], 333, (c) => p.process(c, { reduction: 0 }));
    const latency = DENOISE.latency!(RATE);
    expect(latency).toBe(DENOISE_SIZE);
    for (let i = DENOISE_SIZE * 2; i < output.length; i += 97) expect(output[i]).toBeCloseTo(input[i - latency], 5);
  });

  it('lowers steady hiss and keeps a tone above it', () => {
    const p = DENOISE.create(RATE, 1);
    const hiss = noise(4, 0.02, 3);
    const tone = sine(440, 4, 0.3);
    const mixed = hiss.map((v, i) => (i > RATE * 2 ? v + tone[i] : v));
    chunked([mixed], 512, (c) => p.process(c, { reduction: 24 }));
    const latency = DENOISE.latency!(RATE);
    const hissLeft = rms(mixed, RATE + latency, RATE * 2 - 2048);
    expect(db(hissLeft) - db(rms(hiss, RATE, RATE * 2))).toBeLessThan(-12);
    const toneLeft = rms(mixed, RATE * 3 + latency, RATE * 4);
    expect(Math.abs(db(toneLeft) - db(0.3 / Math.SQRT2))).toBeLessThan(1);
  });
});

describe('true peak', () => {
  it('finds the inter-sample peak of a tone sampled off its crests', () => {
    const meter = new LoudnessMeter(RATE);
    const tone = Float32Array.from({ length: RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 12000 * i) / RATE + Math.PI / 4));
    meter.push([tone, tone]);
    const { peak, truePeak } = meter.reading();
    expect(peak).toBeCloseTo(db(0.5 * Math.SQRT1_2), 1);
    expect(truePeak).toBeGreaterThan(db(0.5) - 0.6);
    expect(truePeak).toBeLessThan(db(0.5) + 0.3);
  });
});

describe('space', () => {
  it('delay repeats an impulse at its time with decaying feedback, chunk size aside', () => {
    const impulse = new Float32Array(RATE);
    impulse[0] = 1;
    const run = (size: number) => {
      const out = impulse.slice();
      const p = DELAY.create(RATE, 1);
      chunked([out], size, (c) => p.process(c, { time: 100, feedback: 50, mix: 100 }));
      return out;
    };
    const out = run(480);
    expect(out[4800]).toBeCloseTo(1, 5);
    expect(out[9600]).toBeCloseTo(0.5, 5);
    expect(out[14400]).toBeCloseTo(0.25, 5);
    expect(out[4799]).toBe(0);
    expect(Array.from(run(37))).toEqual(Array.from(out));
    expect(DELAY.tail!({ time: 100, feedback: 50 })).toBeGreaterThan(0.9);
  });

  it('delay ping-pongs between channels', () => {
    const l = new Float32Array(RATE);
    const r = new Float32Array(RATE);
    l[0] = 1;
    DELAY.create(RATE, 2).process([l, r], { time: 100, feedback: 50, mix: 100, pingpong: 1 });
    expect(l[4800]).toBeCloseTo(1, 5);
    expect(r[9600]).toBeCloseTo(0.5, 5);
    expect(l[9600]).toBeCloseTo(0, 5);
  });

  it('reverb rings out after the dry sound stops and decays longer in a bigger room', () => {
    const decay = (size: number) => {
      const l = new Float32Array(RATE * 3);
      l.set(noise(0.2, 0.5));
      const r = l.slice();
      REVERB.create(RATE, 2).process([l, r], { size, mix: 100, predelay: 0 });
      return [rms(l, RATE * 0.3, RATE * 0.5), rms(l, RATE * 1.5, RATE * 1.7)];
    };
    const [smallEarly, smallLate] = decay(0.2);
    const [bigEarly, bigLate] = decay(0.9);
    expect(smallEarly).toBeGreaterThan(0.005);
    expect(bigLate / bigEarly).toBeGreaterThan(smallLate / smallEarly);
    expect(REVERB.tail!({ size: 0.9 })).toBeGreaterThan(REVERB.tail!({ size: 0.2 }));
  });
});
