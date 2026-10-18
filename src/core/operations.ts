import type { AssetMeta, EffectInstance, Item, ParamValues, Project, Track, TransitionInstance } from './model';
import { findPlacement, trackFrameAt } from './timeline';
import { createId } from './ids';

export type Operation = (project: Project) => Project;

const MIN_LENGTH = 1 / 120;

function mapTracks(project: Project, fn: (track: Track) => Track): Project {
  let changed = false;
  const tracks = project.tracks.map((t) => {
    const next = fn(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...project, tracks } : project;
}

function mapItem(project: Project, itemId: string, fn: (item: Item, track: Track) => Item): Project {
  return mapTracks(project, (track) => {
    const index = track.items.findIndex((i) => i.id === itemId);
    if (index < 0) return track;
    const items = track.items.slice();
    items[index] = fn(items[index], track);
    return { ...track, items };
  });
}

function requireItem(project: Project, itemId: string) {
  const placement = findPlacement(project, itemId);
  if (!placement) throw new Error(`Unknown item ${itemId}`);
  return placement;
}

function requireTrack(project: Project, trackId: string): Track {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown track ${trackId}`);
  return track;
}

export const addAsset = (asset: AssetMeta): Operation => (project) => ({
  ...project,
  assets: { ...project.assets, [asset.id]: asset },
  settings: project.settings ?? {
    width: asset.width,
    height: asset.height,
    fps: asset.fps || 25,
    sampleRate: 48000,
  },
});

export interface InsertOptions {
  trackId: string;
  in?: number;
  out?: number;
  index?: number;
  start?: number;
  id?: string;
}

export const insertItem = (assetId: string, options: InsertOptions): Operation => (project) => {
  const asset = project.assets[assetId];
  if (!asset) throw new Error(`Unknown asset ${assetId}`);
  const track = requireTrack(project, options.trackId);
  const sourceIn = Math.max(asset.start, options.in ?? asset.start);
  const sourceOut = Math.min(asset.end, options.out ?? asset.end);
  if (sourceOut - sourceIn < MIN_LENGTH) throw new Error('Empty source range');
  const item: Item = {
    id: options.id ?? createId('item'),
    source: { assetId, in: sourceIn, out: sourceOut },
    start: Math.max(0, options.start ?? 0),
    effects: [],
    transitionIn: null,
    volume: 1,
  };
  const items = track.items.slice();
  items.splice(Math.max(0, Math.min(options.index ?? items.length, items.length)), 0, item);
  return mapTracks(project, (t) => (t === track ? { ...t, items } : t));
};

export const removeItem = (itemId: string): Operation => (project) =>
  mapTracks(project, (track) => {
    const items = track.items.filter((i) => i.id !== itemId);
    if (items.length === track.items.length) return track;
    if (track.magnetic && items[0]?.transitionIn) items[0] = { ...items[0], transitionIn: null };
    return { ...track, items };
  });

export const moveItem = (itemId: string, index: number): Operation => (project) => {
  const { track } = requireItem(project, itemId);
  const items = track.items.slice();
  const from = items.findIndex((i) => i.id === itemId);
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return mapTracks(project, (t) => (t === track ? { ...t, items } : t));
};

export const shiftItem = (itemId: string, start: number): Operation => (project) =>
  mapItem(project, itemId, (item, track) => (track.magnetic ? item : { ...item, start: Math.max(0, start) }));

export const trimItem = (itemId: string, range: { in?: number; out?: number }): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const asset = project.assets[item.source.assetId];
    let { in: sourceIn, out: sourceOut } = item.source;
    if (range.in !== undefined) sourceIn = Math.min(Math.max(asset.start, range.in), sourceOut - MIN_LENGTH);
    if (range.out !== undefined) sourceOut = Math.max(Math.min(asset.end, range.out), sourceIn + MIN_LENGTH);
    return { ...item, source: { ...item.source, in: sourceIn, out: sourceOut } };
  });

export const splitAt = (time: number, trackId: string, rightId = createId('item')): Operation => (project) => {
  const track = requireTrack(project, trackId);
  const frame = trackFrameAt(track, time);
  if (!frame) return project;
  const layer = frame.transition && frame.transition.progress >= 0.5 ? frame.transition.incoming : frame.base;
  const { item } = layer.placement;
  const cut = layer.sourceTime;
  if (cut - item.source.in < MIN_LENGTH || item.source.out - cut < MIN_LENGTH) return project;
  const left: Item = { ...item, source: { ...item.source, out: cut } };
  const right: Item = {
    ...item,
    id: rightId,
    source: { ...item.source, in: cut },
    start: item.start + (cut - item.source.in),
    transitionIn: null,
    effects: item.effects.map((e) => ({ ...e, id: createId('fx') })),
  };
  const items = track.items.slice();
  const index = items.indexOf(item);
  items.splice(index, 1, left, right);
  return mapTracks(project, (t) => (t === track ? { ...t, items } : t));
};

export const setTransition = (itemId: string, transition: TransitionInstance | null): Operation => (project) =>
  mapItem(project, itemId, (item) => ({ ...item, transitionIn: transition }));

export const setVolume = (itemId: string, volume: number): Operation => (project) =>
  mapItem(project, itemId, (item) => ({ ...item, volume: Math.max(0, volume) }));

export const upsertEffect = (itemId: string, type: string, params: ParamValues): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const existing = item.effects.find((e) => e.type === type);
    if (existing) {
      return {
        ...item,
        effects: item.effects.map((e) => (e === existing ? { ...e, params: { ...e.params, ...params } } : e)),
      };
    }
    const effect: EffectInstance = { id: createId('fx'), type, enabled: true, params };
    return { ...item, effects: [...item.effects, effect] };
  });

export const replaceEffect = (itemId: string, type: string, params: ParamValues | null): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const rest = item.effects.filter((e) => e.type !== type);
    if (!params) return { ...item, effects: rest };
    const previous = item.effects.find((e) => e.type === type);
    const effect: EffectInstance = { id: previous?.id ?? createId('fx'), type, enabled: true, params };
    const index = previous ? item.effects.indexOf(previous) : rest.length;
    const effects = rest.slice();
    effects.splice(index, 0, effect);
    return { ...item, effects };
  });

export const copyEffects = (fromId: string, toIds: readonly string[]): Operation => (project) => {
  const { item: source } = requireItem(project, fromId);
  return toIds.reduce(
    (p, id) =>
      id === fromId
        ? p
        : mapItem(p, id, (item) => ({ ...item, effects: source.effects.map((e) => ({ ...e, id: createId('fx') })) })),
    project,
  );
};

export const clearTrack = (trackId: string): Operation => (project) =>
  mapTracks(project, (t) => (t.id === trackId ? { ...t, items: [] } : t));

export const sequence = (...ops: Operation[]): Operation => (project) => ops.reduce((p, op) => op(p), project);
