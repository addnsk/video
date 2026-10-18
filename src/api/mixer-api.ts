import {
  MASTER,
  STRIP_PROPERTIES,
  addBus,
  deleteStripKeyframe,
  mixOf,
  removeBus,
  renameBus,
  routeOf,
  routeTrack,
  setStrip,
  setStripEffect,
  setStripEffectEnabled,
  setStripKeyframe,
  stripOf,
  type Strip,
  type StripPatch,
  type StripProperty,
} from '../core/mix';
import { createId } from '../core/ids';
import { setTrackMuted, type Operation } from '../core/operations';
import { AUDIO_EFFECTS, audioEffect } from '../effects/audio/builtin';
import { LOUDNESS_TARGETS, type LoudnessReading, type LoudnessTarget } from '../effects/audio/loudness';
import { measureLoudness, normalizeLoudness, type NormalizeResult, type NormalizeTarget } from '../host/loudness';
import type { EditorSession } from '../host/session';

export interface StripInfo {
  readonly volume: number;
  readonly pan: number;
  readonly mute: boolean;
  readonly effects: readonly { readonly type: string; readonly enabled: boolean; readonly params: Readonly<Record<string, unknown>> }[];
  readonly automation: Readonly<Record<string, readonly { readonly t: number; readonly v: number }[]>>;
}

const describeStrip = (strip: Strip): StripInfo => ({
  volume: strip.volume,
  pan: strip.pan,
  mute: strip.mute,
  effects: strip.effects.map(({ type, enabled, params }) => ({ type, enabled, params })),
  automation: Object.fromEntries(Object.entries(strip.animations).map(([k, keys]) => [k, keys.map(({ t, v }) => ({ t, v }))])),
});

export function createMixerApi(session: EditorSession) {
  const { store } = session;
  const apply = (op: Operation, coalesce?: string) => store.dispatch(op, { coalesce });
  const requireStrip = (target: string) => {
    const strip = stripOf(store.project, target);
    if (!strip) throw new Error(`No track, bus or master named "${target}"`);
    return strip;
  };
  const requireProperty = (property: string): StripProperty => {
    if (!(STRIP_PROPERTIES as readonly string[]).includes(property)) throw new Error(`Automatable properties: ${STRIP_PROPERTIES.join(', ')}`);
    return property as StripProperty;
  };
  const isTrack = (target: string) => store.project.tracks.some((t) => t.id === target);

  return {
    state() {
      const mix = mixOf(store.project);
      return {
        tracks: store.project.tracks.map((t) => {
          const route = routeOf(store.project, t.id);
          return { id: t.id, kind: t.kind, output: route.output, ...describeStrip(route.strip), mute: t.muted };
        }),
        buses: mix.buses.map((b) => ({ id: b.id, name: b.name, ...describeStrip(b.strip) })),
        master: describeStrip(mix.master),
      };
    },
    set(target: string, patch: StripPatch) {
      requireStrip(target);
      store.transaction(() => {
        const { mute, ...rest } = patch;
        if (mute !== undefined && isTrack(target)) apply(setTrackMuted(target, mute));
        const levels = isTrack(target) ? rest : patch;
        if (Object.keys(levels).length) apply(setStrip(target, levels), `mixer:${target}:${Object.keys(levels).join(',')}`);
      });
    },
    effect(target: string, type: string, params: Record<string, number> | null) {
      if (!audioEffect(type)) throw new Error(`Unknown audio effect "${type}". Available: ${AUDIO_EFFECTS.map((d) => d.id).join(', ')}`);
      requireStrip(target);
      apply(setStripEffect(target, type, params));
    },
    enableEffect(target: string, type: string, enabled: boolean) {
      requireStrip(target);
      apply(setStripEffectEnabled(target, type, enabled));
    },
    keyframe(target: string, property: string, time: number, value: number) {
      requireStrip(target);
      apply(setStripKeyframe(target, requireProperty(property), time, value));
    },
    clearKeyframe(target: string, property: string, time?: number) {
      requireStrip(target);
      apply(deleteStripKeyframe(target, requireProperty(property), time ?? null));
    },
    addBus(name: string): string {
      const id = createId('bus');
      apply(addBus(name, id));
      return id;
    },
    renameBus: (id: string, name: string) => void apply(renameBus(id, name)),
    removeBus: (id: string) => void apply(removeBus(id)),
    route: (trackId: string, output: string) => void apply(routeTrack(trackId, output)),
    master: MASTER,
  };
}

export function createLoudnessApi(session: EditorSession) {
  return {
    loudness: (): Promise<LoudnessReading> => measureLoudness(session),
    normalize: (target: LoudnessTarget | number | NormalizeTarget = 'youtube'): Promise<NormalizeResult> => normalizeLoudness(session, target),
    loudnessTargets: () => ({ ...LOUDNESS_TARGETS }),
  };
}
