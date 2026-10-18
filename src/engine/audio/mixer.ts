import { PROPERTY, valueAt } from '../../core/animation';
import { carriesAudio, sourceTimeAt, type MediaItem, type Project } from '../../core/model';
import { effectiveAnimations } from '../../core/presets';
import { audibleAt, type Placement } from '../../core/timeline';
import type { MediaPool } from '../media/media-pool';
import { resources } from '../resources';
import { audioEffect } from '../../effects/audio/builtin';
import type { AudioProcessor } from '../../effects/audio/types';
import { addInto, mixInto, resampleLinear, silence, type Envelope, type Planar } from './pcm';
import { StripBank } from './strips';
import { MASTER } from '../../core/mix';
import { planMix, type MixPlan } from './mix-plan';
import { effectLatency, effectTail } from '../../effects/audio/types';

interface ChainState {
  processors: Map<string, AudioProcessor>;
  channels: number;
  next: number;
  used: boolean;
}

export const OUTPUT_CHANNELS = 2;
const MIN_WARMUP_SECONDS = 0.5;
const MAX_TAIL_SECONDS = 30;
const MAX_WARMUP_SECONDS = 12;
const WARMUP_CHUNK_SECONDS = 1;
const CROSSFADE_SECONDS = 0.03;

function crossfade(before: Planar, after: Planar, frames: number): Planar {
  const length = Math.min(frames, after[0]?.length ?? 0);
  after.forEach((ch, c) => {
    const old = before[c];
    for (let i = 0; i < length; i++) {
      const k = (i + 0.5) / length;
      ch[i] = ch[i] * k + old[i] * (1 - k);
    }
  });
  return after;
}

const UNITY_ENVELOPE: Envelope = { gain: () => 1 };

function applyEnvelope(planar: Planar, time: number, rate: number, envelope: Envelope) {
  const frames = planar[0]?.length ?? 0;
  for (let i = 0; i < frames; i++) {
    const g = envelope.gain(time + i / rate);
    if (g !== 1) for (const ch of planar) ch[i] *= g;
  }
}

const clipTail = (item: MediaItem, rate: number) =>
  item.effects.reduce((sum, e) => sum + (e.enabled ? effectTail(audioEffect(e.type), e.params) + effectLatency(audioEffect(e.type), rate) / rate : 0), 0);

const clipLatency = (item: MediaItem, rate: number) =>
  item.effects.reduce((sum, e) => sum + (e.enabled ? effectLatency(audioEffect(e.type), rate) : 0), 0);

function envelopeFor(placement: Placement): Envelope {
  const { start, end, fadeIn, fadeOut, item } = placement;
  const keys = effectiveAnimations(item)[PROPERTY.volume];
  return {
    gain(t) {
      let g = keys ? valueAt(keys, t - start, item.volume) : item.volume;
      if (fadeIn > 0 && t < start + fadeIn) g *= Math.max(0, (t - start) / fadeIn);
      if (fadeOut > 0 && t > end - fadeOut) g *= Math.max(0, (end - t) / fadeOut);
      return g;
    },
  };
}

export class AudioMixer {
  private chains = new Map<string, ChainState>();
  private strips = new StripBank();

  constructor(private pool: MediaPool) {}

  private chain(item: MediaItem, time: number, rate: number, channels: number): ChainState {
    let state = this.chains.get(item.id);
    if (!state || Math.abs(state.next - time) > 2 / rate) {
      state = { processors: new Map(), channels, next: time, used: true };
      this.chains.set(item.id, state);
    }
    state.used = true;
    return state;
  }

  private applyEffects(item: MediaItem, planar: Planar, time: number, rate: number) {
    const effects = item.effects.filter((e) => e.enabled && audioEffect(e.type));
    if (!effects.length) return;
    const state = this.chain(item, time, rate, planar.length);
    for (const effect of effects) {
      let processor = state.processors.get(effect.id);
      if (!processor) {
        processor = audioEffect(effect.type)!.create(rate, planar.length);
        state.processors.set(effect.id, processor);
      }
      processor.process(planar, effect.params);
    }
    state.next = time + (planar[0]?.length ?? 0) / rate;
  }

  private expected: number | null = null;
  private previous: { project: Project; plan: MixPlan } | null = null;

  async mix(project: Project, t0: number, t1: number, rate: number): Promise<Planar> {
    const plan = planMix(project, rate);
    const jumped = this.expected === null || Math.abs(this.expected - t0) > 2 / rate;
    const old = this.previous;
    this.previous = { project, plan };
    this.expected = t1;
    if (!jumped && old && old.plan.delay !== plan.delay) {
      const before = await this.render(old.project, old.plan, t0, t1, rate);
      await this.warm(project, plan, t0, rate);
      const after = await this.render(project, plan, t0, t1, rate);
      return crossfade(before, after, Math.round(CROSSFADE_SECONDS * rate));
    }
    if (jumped) await this.warm(project, plan, t0, rate);
    return this.render(project, plan, t0, t1, rate);
  }

  tailSeconds(project: Project, rate: number): number {
    const plan = planMix(project, rate);
    const buses = plan.nodes.filter((n) => n.kind !== 'track').reduce((sum, n) => sum + n.tail, 0);
    const tracks = Math.max(0, ...plan.nodes.filter((n) => n.kind === 'track').map((n) => n.tail));
    return Math.min(MAX_TAIL_SECONDS, tracks + buses + this.longestClipTail(project, rate) + plan.delay / rate);
  }

  private async warm(project: Project, plan: MixPlan, t0: number, rate: number) {
    if (t0 <= 0 || !this.stateful(project, plan)) return;
    const memory = Math.max(...plan.nodes.map((n) => n.tail), this.longestClipTail(project, rate)) + plan.delay / rate;
    const span = Math.min(MAX_WARMUP_SECONDS, Math.max(MIN_WARMUP_SECONDS, memory));
    const from = Math.max(0, t0 - span);
    for (let t = from; t < t0 - 1e-9; t += WARMUP_CHUNK_SECONDS) await this.render(project, plan, t, Math.min(t0, t + WARMUP_CHUNK_SECONDS), rate);
  }

  private longestClipTail(project: Project, rate: number): number {
    let longest = 0;
    for (const track of project.tracks) for (const item of track.items) if (item.kind === 'media') longest = Math.max(longest, clipTail(item, rate));
    return longest;
  }

  private stateful(project: Project, plan: MixPlan): boolean {
    if (plan.delay > 0 || plan.nodes.some((n) => n.strip.effects.some((e) => e.enabled))) return true;
    return project.tracks.some((t) => t.items.some((i) => i.effects.some((e) => e.enabled && audioEffect(e.type))));
  }

  private async render(project: Project, plan: MixPlan, t0: number, t1: number, rate: number): Promise<Planar> {
    const frames = Math.max(1, Math.round((t1 - t0) * rate));
    const s0 = t0 + plan.delay / rate;
    const s1 = s0 + frames / rate;
    const tails = new Map(plan.nodes.map((n) => [n.id, n.tail]));
    const longest = Math.max(0, ...tails.values()) + this.longestClipTail(project, rate);
    const placements = audibleAt(project, Math.max(0, s0 - longest), s1).filter((p) => {
      const item = p.item;
      return carriesAudio(item, project.assets) && this.pool.has(item.source.assetId);
    });
    const tracks = new Map<string, Planar>();
    for (const p of placements) {
      const reach = p.end + clipTail(p.item as MediaItem, rate) + (tails.get(p.track.id) ?? 0);
      if (reach > s0 && !tracks.has(p.track.id)) tracks.set(p.track.id, silence(OUTPUT_CHANNELS, frames));
    }
    for (const state of this.chains.values()) state.used = false;
    const live = placements.filter((p) => p.end + clipTail(p.item as MediaItem, rate) > s0 && p.start < s1 && tracks.has(p.track.id));
    await Promise.all(live.map(async (p) => {
      const item = p.item as MediaItem;
      const ahead = clipLatency(item, rate) / rate;
      const buffer = tracks.get(p.track.id)!;
      if (p.end > s0 + ahead) await this.mixPlacement(p, item, buffer, s0 + ahead, s1 + ahead, rate);
      this.ringOut(p, item, buffer, s0 + ahead, s1 + ahead, rate);
    }));
    for (const [id, state] of this.chains) if (!state.used) this.chains.delete(id);
    const inputs = new Map<string, Planar>(plan.nodes.filter((n) => n.kind !== 'track').map((n) => [n.id, silence(OUTPUT_CHANNELS, frames)]));
    this.strips.begin();
    for (const node of plan.nodes) {
      const buffer = node.kind === 'track' ? tracks.get(node.id) : inputs.get(node.id);
      if (!buffer) continue;
      const inTime = s0 - (node.arrival - node.latency) / rate;
      const outTime = s0 - node.arrival / rate;
      this.strips.effects(`${node.kind}:${node.id}`, node.strip, buffer, inTime, rate);
      const pre = node.edges.some((e) => e.pre) ? buffer.map((ch) => ch.slice()) : null;
      this.strips.gain(node.strip, buffer, outTime, rate);
      for (const edge of node.edges) {
        const target = inputs.get(edge.to);
        if (target) addInto(target, this.strips.delay(edge.id, edge.pre ? pre! : buffer, edge.pad, edge.gain, outTime, rate));
      }
    }
    this.strips.end();
    return inputs.get(MASTER)!;
  }

  private async mixPlacement(placement: Placement, item: MediaItem, out: Planar, t0: number, t1: number, rate: number) {
    const { start, end } = placement;
    const media = this.pool.acquire(item.source.assetId, 'master');
    const release = media.retain();
    try {
      const sink = await media.audio();
      if (!sink) return;
      const from = sourceTimeAt(item, Math.max(0, t0 - start));
      const to = sourceTimeAt(item, Math.min(end, t1) - start);
      const sourceRate = rate / item.speed;
      const envelope = envelopeFor(placement);
      for await (const sample of sink.samples(from, to)) {
        resources.acquire('audioSample');
        try {
          const planar = this.read(sample, sourceRate);
          const skip = Math.max(0, Math.round((from - sample.timestamp) * sourceRate));
          const sliced = planar.map((ch) => ch.subarray(skip));
          const sourceTime = sample.timestamp + skip / sourceRate;
          const timelineTime = start + (sourceTime - item.source.in) / item.speed;
          const maxFrames = Math.max(0, Math.round((to - sourceTime) * sourceRate));
          const clipped = sliced.map((ch) => ch.subarray(0, maxFrames));
          applyEnvelope(clipped, timelineTime, rate, envelope);
          this.applyEffects(item, clipped, timelineTime, rate);
          mixInto(out, clipped, Math.round((timelineTime - t0) * rate), timelineTime, rate, UNITY_ENVELOPE);
        } finally {
          sample.close();
          resources.release('audioSample');
        }
      }
    } finally {
      release();
    }
  }

  private ringOut(placement: Placement, item: MediaItem, out: Planar, t0: number, t1: number, rate: number) {
    const from = Math.max(t0, placement.end);
    const to = Math.min(t1, placement.end + clipTail(item, rate));
    const frames = Math.round((to - from) * rate);
    const state = this.chains.get(item.id);
    if (frames <= 0 || !state) return;
    const silent = silence(state.channels, frames);
    this.applyEffects(item, silent, from, rate);
    mixInto(out, silent, Math.round((from - t0) * rate), from, rate, UNITY_ENVELOPE);
  }

  private read(sample: { numberOfChannels: number; numberOfFrames: number; sampleRate: number; copyTo(d: Float32Array, o: { planeIndex: number; format: 'f32-planar' }): void }, rate: number): Planar {
    const channels = Math.min(sample.numberOfChannels, OUTPUT_CHANNELS);
    const planar: Planar = [];
    for (let c = 0; c < channels; c++) {
      const data = new Float32Array(sample.numberOfFrames);
      sample.copyTo(data, { planeIndex: c, format: 'f32-planar' });
      planar.push(resampleLinear(data, sample.sampleRate, rate));
    }
    return planar;
  }
}
