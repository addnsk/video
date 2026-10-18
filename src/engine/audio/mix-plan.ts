import { MASTER, busOrder, busOutput, dbToGain, mixOf, routeOf, type Strip } from '../../core/mix';
import type { Project } from '../../core/model';
import { audioEffect } from '../../effects/audio/builtin';
import { effectLatency, effectTail } from '../../effects/audio/types';

export interface MixEdge {
  readonly id: string;
  readonly to: string;
  readonly gain: number;
  readonly pre: boolean;
  readonly pad: number;
}

export interface MixNode {
  readonly id: string;
  readonly kind: 'track' | 'bus' | 'master';
  readonly strip: Strip;
  readonly latency: number;
  readonly arrival: number;
  readonly edges: readonly MixEdge[];
  readonly tail: number;
}

export interface MixPlan {
  readonly nodes: readonly MixNode[];
  readonly delay: number;
}

export const stripLatency = (strip: Strip, rate: number): number =>
  strip.mute ? 0 : strip.effects.reduce((sum, e) => sum + (e.enabled ? effectLatency(audioEffect(e.type), rate) : 0), 0);

export const stripTail = (strip: Strip): number =>
  strip.effects.reduce((sum, e) => sum + (e.enabled ? effectTail(audioEffect(e.type), e.params) : 0), 0);

interface Draft {
  id: string;
  kind: MixNode['kind'];
  strip: Strip;
  latency: number;
  outputs: { to: string; gain: number; pre: boolean }[];
}

export function planMix(project: Project, rate: number): MixPlan {
  const mix = mixOf(project);
  const drafts: Draft[] = [
    ...project.tracks.map((t) => {
      const route = routeOf(project, t.id);
      return {
        id: t.id,
        kind: 'track' as const,
        strip: route.strip,
        latency: stripLatency(route.strip, rate),
        outputs: [{ to: route.output, gain: 1, pre: false }, ...(route.sends ?? []).map((s) => ({ to: s.bus, gain: dbToGain(s.level), pre: s.pre }))],
      };
    }),
    ...busOrder(mix).map((b) => ({ id: b.id, kind: 'bus' as const, strip: b.strip, latency: stripLatency(b.strip, rate), outputs: [{ to: busOutput(mix, b), gain: 1, pre: false }] })),
    { id: MASTER, kind: 'master' as const, strip: mix.master, latency: stripLatency(mix.master, rate), outputs: [] },
  ];
  const arrival = new Map<string, number>();
  const input = new Map<string, number>();
  for (const draft of drafts) {
    const own = (input.get(draft.id) ?? 0) + draft.latency;
    arrival.set(draft.id, own);
    for (const out of draft.outputs) input.set(out.to, Math.max(input.get(out.to) ?? 0, own));
  }
  const delay = arrival.get(MASTER) ?? 0;
  const nodes = drafts.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    strip: draft.strip,
    latency: draft.latency,
    arrival: arrival.get(draft.id)!,
    tail: stripTail(draft.strip) + (draft.latency + Math.max(0, ...draft.outputs.map((out) => input.get(out.to)! - arrival.get(draft.id)!))) / rate,
    edges: draft.outputs.map((out, i) => ({
      id: `${draft.id}>${out.to}#${i}`,
      to: out.to,
      gain: out.gain,
      pre: out.pre,
      pad: input.get(out.to)! - arrival.get(draft.id)!,
    })),
  }));
  return { nodes, delay };
}
