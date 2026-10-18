import { removeKey, shiftAnimations, upsertKey } from './animation';
import { createId } from './ids';
import type {
  ColorScience,
  AssetMeta,
  EffectInstance,
  Item,
  MediaItem,
  ParamValues,
  PresetPhase,
  Project,
  TextItem,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  TransitionInstance,
} from './model';
import { DEFAULT_TEXT, IDENTITY_TRANSFORM, MAX_SPEED, MIN_SPEED, accepts, itemLength, sourceTimeAt } from './model';
import { graphWithNode, graphWithoutNode, remapGraph, remapNodeAnimations } from './graph';
import { findPlacement, trackFrameAt } from './timeline';

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
    const next = fn(track.items[index], track);
    if (next === track.items[index]) return track;
    const items = track.items.slice();
    items[index] = next;
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

function copyEffectSet(item: Item): Pick<Item, 'effects' | 'graph'> & { ids: ReadonlyMap<string, string> } {
  const ids = new Map(item.effects.map((e) => [e.id, createId('fx')]));
  const effects = item.effects.map((e) => ({ ...e, id: ids.get(e.id)! }));
  return item.graph ? { effects, graph: remapGraph(item.graph, ids), ids } : { effects, ids };
}

const isNodePath = (path: string) => path.startsWith('node.');

function withEffectSet(item: Item, set: Pick<Item, 'effects' | 'graph'>): Item {
  const { graph: _graph, ...rest } = item;
  return set.graph ? { ...rest, effects: set.effects, graph: set.graph } : { ...rest, effects: set.effects };
}

function copyGradeOnto(item: Item, source: Item): Item {
  const { ids, ...set } = copyEffectSet(source);
  const own = Object.fromEntries(Object.entries(item.animations).filter(([path]) => !isNodePath(path)));
  const copied = remapNodeAnimations(Object.fromEntries(Object.entries(source.animations).filter(([path]) => isNodePath(path))), ids);
  return { ...withEffectSet(item, set), animations: { ...own, ...copied } };
}

export const updateItem = (itemId: string, fn: (item: Item) => Item): Operation => (project) => mapItem(project, itemId, fn);

const baseItem = (id: string, start: number) => ({
  id,
  start: Math.max(0, start),
  effects: [] as EffectInstance[],
  transitionIn: null,
  volume: 1,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  animations: {},
  presets: {},
});

function placeInto(project: Project, track: Track, item: Item, index?: number): Project {
  if (!accepts(track, item, project.assets)) throw new Error(`Track ${track.id} cannot hold this item`);
  const items = track.items.slice();
  items.splice(Math.max(0, Math.min(index ?? items.length, items.length)), 0, item);
  return mapTracks(project, (t) => (t === track ? { ...t, items } : t));
}

export const addAsset = (asset: AssetMeta): Operation => (project) => ({
  ...project,
  assets: { ...project.assets, [asset.id]: asset },
  settings:
    project.settings ??
    (asset.hasVideo ? { width: asset.width, height: asset.height, fps: asset.fps || 25, sampleRate: 48000 } : null),
});

export interface InsertOptions {
  trackId: string;
  in?: number;
  out?: number;
  index?: number;
  start?: number;
  id?: string;
}

export function createMediaItem(asset: AssetMeta, options: Omit<InsertOptions, 'trackId' | 'index'> = {}): MediaItem {
  const sourceIn = Math.max(asset.start, options.in ?? asset.start);
  const sourceOut = Math.min(asset.end, options.out ?? asset.end);
  if (sourceOut - sourceIn < MIN_LENGTH) throw new Error('Empty source range');
  return {
    ...baseItem(options.id ?? createId('item'), options.start ?? 0),
    kind: 'media',
    source: { assetId: asset.id, in: sourceIn, out: sourceOut },
    speed: 1,
    effects: (asset.defaultEffects ?? []).map((e) => ({ id: createId('fx'), type: e.type, enabled: true, params: e.params })),
  };
}

export const insertItem = (assetId: string, options: InsertOptions): Operation => (project) => {
  const asset = project.assets[assetId];
  if (!asset) throw new Error(`Unknown asset ${assetId}`);
  return placeInto(project, requireTrack(project, options.trackId), createMediaItem(asset, options), options.index);
};

export const placeItem = (item: Item, trackId: string, position: { start?: number; index?: number } = {}): Operation => (project) =>
  placeInto(project, requireTrack(project, trackId), { ...item, start: Math.max(0, position.start ?? item.start) }, position.index);

export const insertText = (
  trackId: string,
  start: number,
  duration: number,
  style: Partial<TextStyle> = {},
  id = createId('item'),
): Operation => (project) => {
  const item: TextItem = { ...baseItem(id, start), kind: 'text', duration: Math.max(MIN_LENGTH, duration), text: { ...DEFAULT_TEXT, ...style } };
  return placeInto(project, requireTrack(project, trackId), item);
};

export const setTextStyle = (itemId: string, style: Partial<TextStyle>): Operation => (project) =>
  mapItem(project, itemId, (item) => (item.kind === 'text' ? { ...item, text: { ...item.text, ...style } } : item));

export const setDuration = (itemId: string, duration: number): Operation => (project) =>
  mapItem(project, itemId, (item) => (item.kind === 'text' ? { ...item, duration: Math.max(MIN_LENGTH, duration) } : item));

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

export const moveToTrack = (itemId: string, trackId: string, position: { start?: number; index?: number }): Operation => (project) => {
  const placement = requireItem(project, itemId);
  const target = requireTrack(project, trackId);
  const moved: Item = { ...placement.item, start: Math.max(0, position.start ?? placement.start), transitionIn: target.magnetic ? placement.item.transitionIn : null };
  if (!accepts(target, moved, project.assets)) return project;
  if (target.id === placement.track.id) {
    if (target.magnetic) return moveItem(itemId, position.index ?? placement.index)(project);
    return mapItem(project, itemId, () => moved);
  }
  const without = removeItem(itemId)(project);
  return placeInto(without, requireTrack(without, trackId), moved, position.index);
};

export const trimItem = (itemId: string, range: { in?: number; out?: number }): Operation => (project) =>
  mapItem(project, itemId, (item, track) => {
    if (item.kind === 'text') {
      if (range.out !== undefined) return { ...item, duration: Math.max(MIN_LENGTH, range.out) };
      if (range.in === undefined || track.magnetic) return item;
      const shift = Math.min(range.in, item.duration - MIN_LENGTH);
      return { ...item, start: Math.max(0, item.start + shift), duration: item.duration - shift, animations: shiftAnimations(item.animations, shift, item.duration - shift) };
    }
    const asset = project.assets[item.source.assetId];
    let { in: sourceIn, out: sourceOut } = item.source;
    if (range.in !== undefined) sourceIn = Math.min(Math.max(asset.start, range.in), sourceOut - MIN_LENGTH);
    if (range.out !== undefined) sourceOut = Math.max(Math.min(asset.end, range.out), sourceIn + MIN_LENGTH);
    const shift = (sourceIn - item.source.in) / item.speed;
    return {
      ...item,
      start: track.magnetic ? item.start : Math.max(0, item.start + shift),
      source: { ...item.source, in: sourceIn, out: sourceOut },
      animations: shift ? shiftAnimations(item.animations, shift, (sourceOut - sourceIn) / item.speed) : item.animations,
    };
  });

export const splitAt = (time: number, trackId: string, rightId = createId('item')): Operation => (project) => {
  const track = requireTrack(project, trackId);
  const frame = trackFrameAt(track, time);
  if (!frame) return project;
  const layer = frame.transition && frame.transition.progress >= 0.5 ? frame.transition.incoming : frame.base;
  const { item } = layer.placement;
  const local = layer.local;
  const length = itemLength(item);
  if (local < MIN_LENGTH || length - local < MIN_LENGTH) return project;
  const leftAnimations = shiftAnimations(item.animations, 0, local);
  const rightAnimations = shiftAnimations(item.animations, local, length - local);
  const { ids, ...copied } = copyEffectSet(item);
  const { out: _out, ...leftPresets } = item.presets;
  const { in: _in, ...rightPresets } = item.presets;
  const head = { animations: leftAnimations, presets: leftPresets };
  const tail = { id: rightId, start: layer.placement.start + local, transitionIn: null, ...copied, animations: remapNodeAnimations(rightAnimations, ids), presets: rightPresets };
  const [left, right]: [Item, Item] =
    item.kind === 'media'
      ? [
          { ...item, ...head, source: { ...item.source, out: sourceTimeAt(item, local) } },
          { ...item, ...tail, source: { ...item.source, in: sourceTimeAt(item, local) } },
        ]
      : [
          { ...item, ...head, duration: local },
          { ...item, ...tail, duration: length - local },
        ];
  const items = track.items.slice();
  items.splice(items.indexOf(item), 1, left, right);
  return mapTracks(project, (t) => (t === track ? { ...t, items } : t));
};

export const setSpeed = (itemId: string, speed: number): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    if (item.kind !== 'media') return item;
    const next = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
    if (next === item.speed) return item;
    const factor = item.speed / next;
    const animations = Object.fromEntries(Object.entries(item.animations).map(([path, keys]) => [path, keys.map((k) => ({ ...k, t: k.t * factor }))]));
    return { ...item, speed: next, animations };
  });

export const setTransition = (itemId: string, transition: TransitionInstance | null): Operation => (project) =>
  mapItem(project, itemId, (item) => ({ ...item, transitionIn: transition }));

export type ItemProps = Partial<{ volume: number; opacity: number; transform: Partial<Transform> }>;

export const setItemProps = (itemId: string, props: ItemProps): Operation => (project) =>
  mapItem(project, itemId, (item) => ({
    ...item,
    volume: props.volume !== undefined ? Math.max(0, props.volume) : item.volume,
    opacity: props.opacity !== undefined ? Math.min(1, Math.max(0, props.opacity)) : item.opacity,
    transform: props.transform ? { ...item.transform, ...props.transform } : item.transform,
  }));

export const setVolume = (itemId: string, volume: number): Operation => setItemProps(itemId, { volume });

export const setKeyframe = (itemId: string, path: string, t: number, value: number): Operation => (project) =>
  mapItem(project, itemId, (item) => ({ ...item, animations: { ...item.animations, [path]: upsertKey(item.animations[path], t, value) } }));

export const deleteKeyframe = (itemId: string, path: string, t: number): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const keys = removeKey(item.animations[path], t);
    const animations = { ...item.animations };
    if (keys.length) animations[path] = keys;
    else delete animations[path];
    return { ...item, animations };
  });

export const setPreset = (itemId: string, phase: PresetPhase, presetId: string | null): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    if ((item.presets[phase] ?? null) === presetId) return item;
    const presets = { ...item.presets };
    if (presetId) presets[phase] = presetId;
    else delete presets[phase];
    return { ...item, presets };
  });

export const clearAnimation = (itemId: string, path: string): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    if (!item.animations[path]) return item;
    const animations = { ...item.animations };
    delete animations[path];
    return { ...item, animations };
  });

export const upsertEffect = (itemId: string, type: string, params: ParamValues): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const existing = item.effects.find((e) => e.type === type);
    if (existing) {
      return { ...item, effects: item.effects.map((e) => (e === existing ? { ...e, params: { ...e.params, ...params } } : e)) };
    }
    const effect: EffectInstance = { id: createId('fx'), type, enabled: true, params };
    return { ...item, effects: [...item.effects, effect], ...(item.graph ? { graph: graphWithNode(item.graph, effect.id) } : {}) };
  });

export const replaceEffect = (itemId: string, type: string, params: ParamValues | null): Operation => (project) =>
  mapItem(project, itemId, (item) => {
    const rest = item.effects.filter((e) => e.type !== type);
    if (!params) {
      if (rest.length === item.effects.length) return item;
      const removed = item.effects.filter((e) => e.type === type);
      const graph = item.graph && removed.reduce((g, e) => graphWithoutNode(g, e.id), item.graph);
      return { ...item, effects: rest, ...(graph ? { graph } : {}) };
    }
    const previous = item.effects.find((e) => e.type === type);
    const effect: EffectInstance = { id: previous?.id ?? createId('fx'), type, enabled: true, params };
    const index = previous ? item.effects.indexOf(previous) : rest.length;
    const effects = rest.slice();
    effects.splice(index, 0, effect);
    return { ...item, effects, ...(item.graph && !previous ? { graph: graphWithNode(item.graph, effect.id) } : {}) };
  });

export const copyEffects = (fromId: string, toIds: readonly string[]): Operation => (project) => {
  const { item: source } = requireItem(project, fromId);
  return toIds.reduce(
    (p, id) => (id === fromId ? p : mapItem(p, id, (item) => copyGradeOnto(item, source))),
    project,
  );
};

export const clearTrack = (trackId: string): Operation => (project) =>
  mapTracks(project, (t) => (t.id === trackId ? { ...t, items: [] } : t));

export const addTrack = (kind: TrackKind, id = createId(kind === 'video' ? 'v' : 'a')): Operation => (project) => {
  const track: Track = { id, kind, magnetic: false, muted: false, items: [] };
  const tracks = project.tracks.slice();
  const lastOfKind = tracks.map((t) => t.kind).lastIndexOf(kind);
  tracks.splice(lastOfKind + 1, 0, track);
  return { ...project, tracks };
};

export const removeTrack = (trackId: string): Operation => (project) => {
  const track = requireTrack(project, trackId);
  if (track.magnetic) return project;
  return { ...project, tracks: project.tracks.filter((t) => t !== track) };
};

export const setTrackMuted = (trackId: string, muted: boolean): Operation => (project) =>
  mapTracks(project, (t) => (t.id === trackId ? { ...t, muted } : t));

export const sequence = (...ops: Operation[]): Operation => (project) => ops.reduce((p, op) => op(p), project);

export const setColorScience = (science: ColorScience): Operation => (project) =>
  project.settings && (project.settings.colorScience ?? 'display') !== science ? { ...project, settings: { ...project.settings, colorScience: science } } : project;

export const setAssetColorSpace = (assetId: string, colorSpace: string): Operation => (project) => {
  const asset = project.assets[assetId];
  if (!asset || asset.colorSpace === colorSpace) return project;
  return { ...project, assets: { ...project.assets, [assetId]: { ...asset, colorSpace } } };
};
