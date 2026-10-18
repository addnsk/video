import { PROPERTY, baseValue, upsertKey } from './animation';
import type { Animations, Easing, Item, Keyframe, PresetPhase } from './model';
import { itemLength } from './model';

export type { PresetPhase };
export type PresetValue = number | { readonly offset: number };

export interface PresetKey {
  readonly at: number;
  readonly value: PresetValue;
  readonly ease?: Easing;
}

export interface PresetChannel {
  readonly path: string;
  readonly keys: readonly PresetKey[];
}

export interface AnimationPreset {
  readonly id: string;
  readonly name: string;
  readonly phase: PresetPhase;
  readonly duration: number;
  readonly channels: readonly PresetChannel[];
}

const BASE = { offset: 0 } as const;
const fadeIn = { path: PROPERTY.opacity, keys: [{ at: 0, value: 0, ease: 'out' }, { at: 1, value: BASE }] } as const;
const fadeOut = { path: PROPERTY.opacity, keys: [{ at: 0, value: BASE, ease: 'in' }, { at: 1, value: 0 }] } as const;

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  { id: 'fade-in', name: 'Fade in', phase: 'in', duration: 0.5, channels: [fadeIn] },
  {
    id: 'rise', name: 'Rise', phase: 'in', duration: 0.6,
    channels: [fadeIn, { path: PROPERTY.y, keys: [{ at: 0, value: { offset: 0.08 }, ease: 'out' }, { at: 1, value: BASE }] }],
  },
  {
    id: 'pop', name: 'Pop', phase: 'in', duration: 0.45,
    channels: [
      { path: PROPERTY.opacity, keys: [{ at: 0, value: 0, ease: 'out' }, { at: 0.4, value: BASE }] },
      { path: PROPERTY.scale, keys: [{ at: 0, value: { offset: -0.4 }, ease: 'out' }, { at: 0.7, value: { offset: 0.06 }, ease: 'inOut' }, { at: 1, value: BASE }] },
    ],
  },
  {
    id: 'slide-left', name: 'Slide from right', phase: 'in', duration: 0.6,
    channels: [fadeIn, { path: PROPERTY.x, keys: [{ at: 0, value: { offset: 0.25 }, ease: 'out' }, { at: 1, value: BASE }] }],
  },
  { id: 'fade-out', name: 'Fade out', phase: 'out', duration: 0.5, channels: [fadeOut] },
  {
    id: 'sink', name: 'Sink', phase: 'out', duration: 0.6,
    channels: [fadeOut, { path: PROPERTY.y, keys: [{ at: 0, value: BASE, ease: 'in' }, { at: 1, value: { offset: 0.08 } }] }],
  },
  {
    id: 'shrink', name: 'Shrink', phase: 'out', duration: 0.4,
    channels: [fadeOut, { path: PROPERTY.scale, keys: [{ at: 0, value: BASE, ease: 'in' }, { at: 1, value: { offset: -0.4 } }] }],
  },
  {
    id: 'ken-burns', name: 'Slow zoom', phase: 'whole', duration: 0,
    channels: [{ path: PROPERTY.scale, keys: [{ at: 0, value: BASE, ease: 'inOut' }, { at: 1, value: { offset: 0.12 } }] }],
  },
  {
    id: 'drift', name: 'Drift', phase: 'whole', duration: 0,
    channels: [{ path: PROPERTY.x, keys: [{ at: 0, value: { offset: 0.03 } }, { at: 1, value: { offset: -0.03 } }] }],
  },
];

export const animationPreset = (id: string): AnimationPreset | undefined => ANIMATION_PRESETS.find((p) => p.id === id);

const MAX_PHASE_SHARE = 0.45;
const EPSILON = 1e-3;

export function presetWindow(preset: AnimationPreset, length: number): [number, number] {
  if (preset.phase === 'whole') return [0, length];
  const duration = Math.min(preset.duration, length * MAX_PHASE_SHARE);
  return preset.phase === 'in' ? [0, duration] : [length - duration, length];
}

function withPreset(item: Item, animations: Animations, preset: AnimationPreset): Animations {
  const length = itemLength(item);
  const [from, to] = presetWindow(preset, length);
  const out: Record<string, readonly Keyframe[]> = { ...animations };
  for (const channel of preset.channels) {
    const base = baseValue(item, channel.path);
    let keys = (out[channel.path] ?? []).filter((k) => k.t < from - EPSILON || k.t > to + EPSILON);
    for (const key of channel.keys) {
      const value = typeof key.value === 'number' ? key.value : base + key.value.offset;
      keys = upsertKey(keys, from + key.at * (to - from), value, key.ease);
    }
    out[channel.path] = keys;
  }
  return out;
}

const PHASE_ORDER: readonly PresetPhase[] = ['whole', 'in', 'out'];
const resolved = new WeakMap<Item, Animations>();

export function effectiveAnimations(item: Item): Animations {
  const phases = PHASE_ORDER.filter((phase) => item.presets[phase]);
  if (!phases.length) return item.animations;
  const cached = resolved.get(item);
  if (cached) return cached;
  let animations = item.animations;
  for (const phase of phases) {
    const preset = animationPreset(item.presets[phase]!);
    if (preset?.phase === phase) animations = withPreset(item, animations, preset);
  }
  resolved.set(item, animations);
  return animations;
}
