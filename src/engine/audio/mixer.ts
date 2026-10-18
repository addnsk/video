import { PROPERTY, valueAt } from '../../core/animation';
import { sourceTimeAt, type MediaItem, type Project } from '../../core/model';
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
import { effectLatency } from '../../effects/audio/types';

interface ChainState {
  processors: Map<string, AudioProcessor>;
  next: number;
  used: boolean;
}

export const OUTPUT_CHANNELS = 2;
const WARMUP_SECONDS = 1.5;

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

  private chain(item: MediaItem, time: number, rate: number): ChainState {
    let state = this.chains.get(item.id);
    if (!state || Math.abs(state.next - time) > 2 / rate) {
      state = { processors: new Map(), next: time, used: true };
      this.chains.set(item.id, state);
    }
    state.used = true;
    return state;
  }

  private applyEffects(item: MediaItem, planar: Planar, time: number, rate: number) {
    const effects = item.effects.filter((e) => e.enabled && audioEffect(e.type));
    if (!effects.length) return;
    const state = this.chain(item, time, rate);
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

  async mix(project: Project, t0: number, t1: number, rate: number): Promise<Planar> {
    const plan = planMix(project, rate);
    const jumped = this.expected === null || Math.abs(this.expected - t0) > 2 / rate;
    if (jumped && t0 > 0 && this.stateful(project, plan)) await this.render(project, plan, Math.max(0, t0 - WARMUP_SECONDS), t0, rate);
    const out = await this.render(project, plan, t0, t1, rate);
    this.expected = t1;
    return out;
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
    const longest = Math.max(0, ...tails.values());
    const placements = audibleAt(project, Math.max(0, s0 - longest), s1).filter((p) => {
      const item = p.item;
      return item.kind === 'media' && project.assets[item.source.assetId]?.hasAudio && this.pool.has(item.source.assetId);
    });
    const tracks = new Map<string, Planar>();
    for (const p of placements) if (p.end > s0 - (tails.get(p.track.id) ?? 0) && !tracks.has(p.track.id)) tracks.set(p.track.id, silence(OUTPUT_CHANNELS, frames));
    for (const state of this.chains.values()) state.used = false;
    const sounding = placements.filter((p) => p.end > s0 && p.start < s1);
    await Promise.all(sounding.map((p) => {
      const item = p.item as MediaItem;
      const ahead = clipLatency(item, rate) / rate;
      return this.mixPlacement(p, item, tracks.get(p.track.id)!, s0 + ahead, s1 + ahead, rate);
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
          this.applyEffects(item, clipped, timelineTime, rate);
          mixInto(out, clipped, Math.round((timelineTime - t0) * rate), timelineTime, rate, envelope);
        } finally {
          sample.close();
          resources.release('audioSample');
        }
      }
    } finally {
      release();
    }
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
