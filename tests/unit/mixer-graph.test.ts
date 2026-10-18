import { describe, expect, it } from 'vitest';
import { MASTER, addBus, routeBus, routeTrack, setSend, setStripEffect, setStrip } from '../../src/core/mix';
import { emptyProject, type Project } from '../../src/core/model';
import { addAsset, addTrack, insertItem, sequence, upsertEffect } from '../../src/core/operations';
import { AudioMixer } from '../../src/engine/audio/mixer';
import { planMix } from '../../src/engine/audio/mix-plan';
import type { MediaPool } from '../../src/engine/media/media-pool';
import { DENOISE_SIZE } from '../../src/effects/audio/denoise';
import { asset } from './fixtures';

const RATE = 48000;
const CHUNK = 1024;

const clickAt = (seconds: number) => (t: number) => (Math.abs(t - seconds) < 0.5 / RATE ? 1 : 0);

function fakePool(signals: Record<string, (t: number) => number>): MediaPool {
  return {
    has: (id: string) => id in signals,
    acquire: (id: string) => ({
      retain: () => () => undefined,
      audio: async () => ({
        async *samples(from: number, to: number) {
          const first = Math.floor(from * RATE / CHUNK) * CHUNK;
          for (let frame = first; frame < to * RATE; frame += CHUNK) {
            const data = Float32Array.from({ length: CHUNK }, (_, i) => signals[id]((frame + i) / RATE));
            yield {
              timestamp: frame / RATE,
              numberOfChannels: 1,
              numberOfFrames: CHUNK,
              sampleRate: RATE,
              copyTo: (target: Float32Array) => target.set(data),
              close: () => undefined,
            };
          }
        },
      }),
    }),
  } as unknown as MediaPool;
}

const audioAsset = (id: string) => ({ ...asset(id, 4), hasVideo: false, width: 0, height: 0, fps: 0 });

const twoTracks = (): Project =>
  sequence(
    addAsset(audioAsset('a')),
    addAsset(audioAsset('b')),
    addTrack('audio', 'a2'),
    insertItem('a', { trackId: 'a1', start: 0, id: 'x' }),
    insertItem('b', { trackId: 'a2', start: 0, id: 'y' }),
  )(emptyProject());

const render = async (mixer: AudioMixer, project: Project, from: number, to: number, step = 0.1) => {
  const out: Float32Array[] = [];
  for (let t = from; t < to - 1e-9; t += step) out.push((await mixer.mix(project, t, Math.min(to, t + step), RATE))[0]);
  const joined = new Float32Array(out.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of out) {
    joined.set(c, at);
    at += c.length;
  }
  return joined;
};

const peaks = (data: Float32Array, threshold = 0.05) => {
  const at: number[] = [];
  data.forEach((v, i) => Math.abs(v) > threshold && at.push(i));
  return at;
};

describe('mix plan', () => {
  it('pads the faster paths to the slowest one', () => {
    const project = sequence(addBus('Clean', 'bus1'), routeTrack('a1', 'bus1'), setStripEffect('a1', 'denoise', { reduction: 0 }), setStripEffect(MASTER, 'limiter', {}))(twoTracks());
    const plan = planMix(project, RATE);
    const node = (id: string) => plan.nodes.find((n) => n.id === id)!;
    expect(node('a1').latency).toBe(DENOISE_SIZE);
    expect(node('a2').edges[0].pad).toBe(DENOISE_SIZE);
    expect(node('bus1').edges[0].pad).toBe(0);
    expect(plan.delay).toBe(DENOISE_SIZE + node(MASTER).latency);
    expect(node('a1').tail).toBeGreaterThan(DENOISE_SIZE / RATE - 1e-9);
  });

  it('orders buses so sources come before the buses they feed and refuses loops', () => {
    const project = sequence(addBus('Sub', 'sub'), addBus('Group', 'group'), routeBus('group', 'sub'))(twoTracks());
    const ids = planMix(project, RATE).nodes.map((n) => n.id);
    expect(ids.indexOf('group')).toBeLessThan(ids.indexOf('sub'));
    expect(() => routeBus('sub', 'group')(project)).toThrow(/loop/);
    expect(() => routeBus('sub', 'sub')(project)).toThrow(/loop/);
  });
});

describe('mixer graph', () => {
  it('keeps tracks aligned when one of them has a latency', async () => {
    const project = setStripEffect('a1', 'denoise', { reduction: 0 })(twoTracks());
    const mixer = new AudioMixer(fakePool({ a: clickAt(0.5), b: clickAt(0.5) }));
    const out = await render(mixer, project, 0, 1);
    const hits = peaks(out, 0.5);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits) - Math.min(...hits)).toBeLessThan(4);
    expect(Math.abs(Math.min(...hits) - RATE * 0.5)).toBeLessThan(4);
  });

  it('compensates clip effect latency', async () => {
    const project = upsertEffect('x', 'denoise', { reduction: 0 })(twoTracks());
    const mixer = new AudioMixer(fakePool({ a: clickAt(0.5), b: () => 0 }));
    const hits = peaks(await render(mixer, project, 0, 1), 0.5);
    expect(Math.abs(hits[0] - RATE * 0.5)).toBeLessThan(4);
  });

  it('sends a track to a bus before or after its fader', async () => {
    const base = sequence(addBus('Echo', 'fx'), setStripEffect('fx', 'delay', { time: 100, feedback: 0, mix: 100 }), setStrip('a1', { volume: -60 }))(twoTracks());
    const post = setSend('a1', 'fx', 0)(base);
    const pre = setSend('a1', 'fx', 0, true)(base);
    const signals = { a: clickAt(0.2), b: () => 0 };
    const postOut = await render(new AudioMixer(fakePool(signals)), post, 0, 1);
    const preOut = await render(new AudioMixer(fakePool(signals)), pre, 0, 1);
    expect(peaks(postOut, 0.01)).toEqual([]);
    expect(peaks(preOut, 0.5).map((i) => Math.round(i / 48))).toEqual([300]);
  });

  it('keeps reverb and delay tails running after the last clip ends', async () => {
    const project = sequence(
      addAsset({ ...audioAsset('short'), end: 0.3 }),
      insertItem('short', { trackId: 'a1', start: 0, id: 's' }),
      setStripEffect('a1', 'delay', { time: 400, feedback: 0, mix: 100 }),
    )(emptyProject());
    const out = await render(new AudioMixer(fakePool({ short: clickAt(0.1) })), project, 0, 1);
    expect(peaks(out, 0.5).map((i) => Math.round(i / 48))).toEqual([500]);
  });

  it('warms effects up after a seek so the output matches a continuous run', async () => {
    const project = setStripEffect('a1', 'delay', { time: 300, feedback: 0, mix: 100 })(twoTracks());
    const signals = { a: (t: number) => Math.sin(2 * Math.PI * 220 * t) * 0.5, b: () => 0 };
    const continuous = await render(new AudioMixer(fakePool(signals)), project, 0, 2.5);
    const jumped = await render(new AudioMixer(fakePool(signals)), project, 2, 2.5);
    const reference = continuous.subarray(RATE * 2);
    for (let i = 0; i < jumped.length; i += 61) expect(jumped[i]).toBeCloseTo(reference[i], 4);
  });
});
