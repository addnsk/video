import { removeKey, upsertKey, valueAt } from './animation';
import { createId } from './ids';
import type { Animations, EffectInstance, ParamValues, Project } from './model';
import type { Operation } from './operations';

export const MASTER = 'master';

export interface Strip {
  readonly trim?: number;
  readonly volume: number;
  readonly pan: number;
  readonly mute: boolean;
  readonly effects: readonly EffectInstance[];
  readonly animations: Animations;
}

export interface Send {
  readonly bus: string;
  readonly level: number;
  readonly pre: boolean;
}

export interface TrackRoute {
  readonly strip: Strip;
  readonly output: string;
  readonly sends?: readonly Send[];
}

export interface Bus {
  readonly id: string;
  readonly name: string;
  readonly strip: Strip;
  readonly output?: string;
}

export interface Mix {
  readonly tracks: Readonly<Record<string, TrackRoute>>;
  readonly buses: readonly Bus[];
  readonly master: Strip;
}

export const STRIP_PROPERTIES = ['volume', 'pan'] as const;
export type StripProperty = (typeof STRIP_PROPERTIES)[number];

export const MIN_DB = -60;
export const MAX_DB = 12;

export const UNITY: Strip = { volume: 0, pan: 0, mute: false, effects: [], animations: {} };

export const EMPTY_MIX: Mix = { tracks: {}, buses: [], master: UNITY };

export const mixOf = (project: Project): Mix => project.mix ?? EMPTY_MIX;

const hasBus = (mix: Mix, id: string) => mix.buses.some((b) => b.id === id);

export const routeOf = (project: Project, trackId: string): TrackRoute => {
  const mix = mixOf(project);
  const route = mix.tracks[trackId];
  const output = route && (route.output === MASTER || hasBus(mix, route.output)) ? route.output : MASTER;
  const sends = (route?.sends ?? []).filter((s) => hasBus(mix, s.bus));
  return { strip: route?.strip ?? UNITY, output, sends };
};

export const busOutput = (mix: Mix, bus: Bus): string => (bus.output && bus.output !== bus.id && hasBus(mix, bus.output) ? bus.output : MASTER);

export const busOrder = (mix: Mix): Bus[] => {
  const order: Bus[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (bus: Bus) => {
    if (state.get(bus.id) === 'done') return;
    if (state.get(bus.id) === 'visiting') throw new MixError(`Bus routing loops through "${bus.name}"`);
    state.set(bus.id, 'visiting');
    for (const source of mix.buses) if (source !== bus && busOutput(mix, source) === bus.id) visit(source);
    state.set(bus.id, 'done');
    order.push(bus);
  };
  for (const bus of mix.buses) visit(bus);
  return order;
};

const feeds = (mix: Mix, from: string, to: string): boolean => {
  for (let current = from, steps = 0; current !== MASTER && steps <= mix.buses.length; steps++) {
    if (current === to) return true;
    const bus = mix.buses.find((b) => b.id === current);
    if (!bus) return false;
    current = busOutput(mix, bus);
  }
  return false;
};

export const stripOf = (project: Project, target: string): Strip | null => {
  const mix = mixOf(project);
  if (target === MASTER) return mix.master;
  const bus = mix.buses.find((b) => b.id === target);
  if (bus) return bus.strip;
  return project.tracks.some((t) => t.id === target) ? routeOf(project, target).strip : null;
};

export const dbToGain = (db: number): number => (db <= MIN_DB ? 0 : 10 ** (db / 20));

export const gainToDb = (gain: number): number => (gain <= 0 ? -Infinity : 20 * Math.log10(gain));

export const stripValue = (strip: Strip, property: StripProperty, time: number): number => {
  const value = valueAt(strip.animations[property], time, strip[property]);
  return property === 'pan' ? Math.max(-1, Math.min(1, value)) : Math.max(MIN_DB, Math.min(MAX_DB, value));
};

export const panGains = (pan: number): [number, number] => {
  const p = Math.max(-1, Math.min(1, pan));
  return [p > 0 ? 1 - p : 1, p < 0 ? 1 + p : 1];
};

export class MixError extends Error {}

const withMix = (project: Project, update: (mix: Mix) => Mix): Project => {
  const next = update(mixOf(project));
  return next === project.mix ? project : { ...project, mix: next };
};

const mapStrip = (target: string, update: (strip: Strip) => Strip): Operation => (project) => {
  const strip = stripOf(project, target);
  if (!strip) throw new MixError(`No track, bus or master named "${target}"`);
  const next = update(strip);
  if (next === strip) return project;
  return withMix(project, (mix) => {
    if (target === MASTER) return { ...mix, master: next };
    if (mix.buses.some((b) => b.id === target)) return { ...mix, buses: mix.buses.map((b) => (b.id === target ? { ...b, strip: next } : b)) };
    return { ...mix, tracks: { ...mix.tracks, [target]: { ...routeOf(project, target), strip: next } } };
  });
};

const clampProperty = (property: StripProperty, value: number) =>
  property === 'pan' ? Math.max(-1, Math.min(1, value)) : Math.max(MIN_DB, Math.min(MAX_DB, value));

export type StripPatch = Partial<Pick<Strip, 'trim' | 'volume' | 'pan' | 'mute'>>;

export const setStrip = (target: string, patch: StripPatch): Operation =>
  mapStrip(target, (strip) => ({
    ...strip,
    ...(patch.trim !== undefined ? { trim: Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, patch.trim)) } : {}),
    ...(patch.volume !== undefined ? { volume: clampProperty('volume', patch.volume) } : {}),
    ...(patch.pan !== undefined ? { pan: clampProperty('pan', patch.pan) } : {}),
    ...(patch.mute !== undefined ? { mute: patch.mute } : {}),
  }));

export const setStripEffect = (target: string, type: string, params: ParamValues | null, id = createId('fx')): Operation =>
  mapStrip(target, (strip) => {
    const existing = strip.effects.find((e) => e.type === type);
    if (!params) return existing ? { ...strip, effects: strip.effects.filter((e) => e !== existing) } : strip;
    if (existing) return { ...strip, effects: strip.effects.map((e) => (e === existing ? { ...e, params: { ...e.params, ...params } } : e)) };
    return { ...strip, effects: [...strip.effects, { id, type, enabled: true, params }] };
  });

export const setStripEffectEnabled = (target: string, type: string, enabled: boolean): Operation =>
  mapStrip(target, (strip) => ({ ...strip, effects: strip.effects.map((e) => (e.type === type ? { ...e, enabled } : e)) }));

export const setStripKeyframe = (target: string, property: StripProperty, time: number, value: number): Operation =>
  mapStrip(target, (strip) => ({
    ...strip,
    animations: { ...strip.animations, [property]: upsertKey(strip.animations[property], Math.max(0, time), clampProperty(property, value)) },
  }));

export const deleteStripKeyframe = (target: string, property: StripProperty, time: number | null): Operation =>
  mapStrip(target, (strip) => {
    const keys = time === null ? [] : removeKey(strip.animations[property], time);
    const animations = { ...strip.animations };
    if (keys.length) animations[property] = keys;
    else delete animations[property];
    return { ...strip, animations };
  });

export const addBus = (name: string, id = createId('bus')): Operation => (project) => {
  if (stripOf(project, id)) throw new MixError(`"${id}" is already used`);
  return withMix(project, (mix) => ({ ...mix, buses: [...mix.buses, { id, name, strip: UNITY }] }));
};

export const renameBus = (id: string, name: string): Operation => (project) =>
  withMix(project, (mix) => ({ ...mix, buses: mix.buses.map((b) => (b.id === id ? { ...b, name } : b)) }));

export const removeBus = (id: string): Operation => (project) => {
  const mix = mixOf(project);
  if (!hasBus(mix, id)) return project;
  const tracks = Object.fromEntries(
    Object.entries(mix.tracks).map(([k, r]) => [k, { ...r, output: r.output === id ? MASTER : r.output, ...(r.sends ? { sends: r.sends.filter((s) => s.bus !== id) } : {}) }]),
  );
  const buses = mix.buses.filter((b) => b.id !== id).map((b) => (b.output === id ? { ...b, output: MASTER } : b));
  return { ...project, mix: { ...mix, tracks, buses } };
};

export const routeBus = (busId: string, output: string): Operation => (project) => {
  const mix = mixOf(project);
  if (!hasBus(mix, busId)) throw new MixError(`No bus "${busId}"`);
  if (output !== MASTER && !hasBus(mix, output)) throw new MixError(`No bus "${output}"`);
  if (output !== MASTER && feeds(mix, output, busId)) throw new MixError('That routing would make a loop');
  return { ...project, mix: { ...mix, buses: mix.buses.map((b) => (b.id === busId ? { ...b, output } : b)) } };
};

export const setSend = (trackId: string, busId: string, level: number | null, pre = false): Operation => (project) => {
  if (!project.tracks.some((t) => t.id === trackId)) throw new MixError(`No track "${trackId}"`);
  const mix = mixOf(project);
  if (!hasBus(mix, busId)) throw new MixError(`No bus "${busId}"`);
  const route = routeOf(project, trackId);
  const others = (route.sends ?? []).filter((s) => s.bus !== busId);
  const sends = level === null ? others : [...others, { bus: busId, level: Math.max(MIN_DB, Math.min(MAX_DB, level)), pre }];
  return { ...project, mix: { ...mix, tracks: { ...mix.tracks, [trackId]: { ...route, sends } } } };
};

export const routeTrack = (trackId: string, output: string): Operation => (project) => {
  if (!project.tracks.some((t) => t.id === trackId)) throw new MixError(`No track "${trackId}"`);
  if (output !== MASTER && !mixOf(project).buses.some((b) => b.id === output)) throw new MixError(`No bus "${output}"`);
  return withMix(project, (mix) => ({ ...mix, tracks: { ...mix.tracks, [trackId]: { ...routeOf(project, trackId), output } } }));
};

export const forgetTrack = (project: Project, trackId: string): Project => {
  const mix = project.mix;
  if (!mix || !(trackId in mix.tracks)) return project;
  const { [trackId]: _gone, ...tracks } = mix.tracks;
  return { ...project, mix: { ...mix, tracks } };
};

export const TRIM_LIMIT = 36;

export const scaleMaster = (deltaDb: number): Operation =>
  mapStrip(MASTER, (strip) => ({ ...strip, trim: Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, (strip.trim ?? 0) + deltaDb)) }));
