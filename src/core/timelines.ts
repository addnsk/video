import { liftRange, overwriteEdit, spansOf, type EditTarget } from './editing';
import { createId } from './ids';
import type { AssetMeta, Item, Project, ProjectSettings, TimelineData, Track } from './model';
import { activeTimeline, nestedAssetId, nestedTimelineOf, snapshot, timelineData } from './timeline-data';
export { MAIN_TIMELINE, DEFAULT_TIMELINE_NAME, activeTimeline, nestedAssetId, nestedTimelineOf, timelineData, nestedProject } from './timeline-data';
import { emptyProject, itemLength } from './model';
import type { Operation } from './operations';
import { placeTrack, projectDuration } from './timeline';

const MIN_NESTED_LENGTH = 1 / 120;

export interface TimelineInfo {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export function timelineList(project: Project): TimelineInfo[] {
  const active = activeTimeline(project);
  const others = Object.values(project.timelines ?? {}).map(({ id, name }) => ({ id, name, active: false }));
  return [{ ...active, active: true }, ...others];
}

const durationOf = (project: Project, data: TimelineData) => projectDuration({ ...project, tracks: data.tracks });

function emptyTracks(): Track[] {
  return emptyProject().tracks.map((t) => ({ ...t }));
}

const uniqueName = (project: Project, base: string) => {
  const names = new Set(timelineList(project).map((t) => t.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
};

export interface TimelineFormat {
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
}

function formatSettings(project: Project, format: TimelineFormat): ProjectSettings | undefined {
  const base = project.settings;
  if (!base && !format.width && !format.height && !format.fps) return undefined;
  const width = Math.round(format.width ?? base?.width ?? 1920);
  const height = Math.round(format.height ?? base?.height ?? 1080);
  const fps = format.fps ?? base?.fps ?? 25;
  if (!(width >= 16 && width <= 16384 && height >= 16 && height <= 16384)) throw new Error('Frame size must be 16–16384 pixels');
  if (width % 2 || height % 2) throw new Error('Frame width and height must be even');
  if (!(fps >= 1 && fps <= 240)) throw new Error('Frame rate must be 1–240');
  return { sampleRate: 48000, ...base, width, height, fps };
}

export const addTimeline = (name: string | undefined, id = createId('timeline'), tracks: readonly Track[] = emptyTracks(), format: TimelineFormat = {}): Operation => (project) => {
  const count = timelineList(project).length;
  const settings = formatSettings(project, format);
  const data: TimelineData = { id, name: uniqueName(project, name?.trim() || `Timeline ${count + 1}`), tracks, ...(settings ? { settings } : {}) };
  return refreshNested({ ...project, timeline: activeTimeline(project), timelines: { ...project.timelines, [id]: data } });
};

export const switchTimeline = (id: string): Operation => (project) => {
  const active = activeTimeline(project);
  if (active.id === id) return project;
  const target = project.timelines?.[id];
  if (!target) throw new Error(`Unknown timeline ${id}`);
  const { [id]: _taken, ...rest } = project.timelines ?? {};
  const { markers: _markers, subtitles: _subtitles, mix: _mix, ...base } = project;
  const settings = target.settings && project.settings ? { ...target.settings, colorScience: project.settings.colorScience } : (target.settings ?? project.settings);
  return refreshNested({
    ...base,
    settings: settings ?? null,
    tracks: target.tracks,
    ...(target.markers ? { markers: target.markers } : {}),
    ...(target.subtitles ? { subtitles: target.subtitles } : {}),
    ...(target.mix ? { mix: target.mix } : {}),
    timeline: { id: target.id, name: target.name },
    timelines: { ...rest, [active.id]: snapshot(project) },
  });
};

export const renameTimeline = (id: string, name: string): Operation => (project) => {
  const clean = name.trim();
  if (!clean) throw new Error('Timeline name cannot be empty');
  const assets = project.assets[nestedAssetId(id)] ? { ...project.assets, [nestedAssetId(id)]: { ...project.assets[nestedAssetId(id)], name: clean } } : project.assets;
  if (activeTimeline(project).id === id) return { ...project, assets, timeline: { id, name: clean } };
  const data = project.timelines?.[id];
  if (!data) throw new Error(`Unknown timeline ${id}`);
  return { ...project, assets, timelines: { ...project.timelines, [id]: { ...data, name: clean } } };
};

export const duplicateTimeline = (id: string, newId = createId('timeline')): Operation => (project) => {
  const data = timelineData(project, id);
  if (!data) throw new Error(`Unknown timeline ${id}`);
  const remap = new Map<string, string>();
  const tracks = data.tracks.map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, id: remap.set(i.id, createId('item')).get(i.id)! })) }));
  const links = new Map<string, string>();
  const relinked = tracks.map((t) => ({ ...t, items: t.items.map((i) => (i.link ? { ...i, link: links.get(i.link) ?? links.set(i.link, createId('link')).get(i.link)! } : i)) }));
  const markers = data.markers?.map((m) => ({ ...m, id: createId('marker') }));
  const subtitles = data.subtitles?.map((track) => ({ ...track, id: createId('subtitles'), cues: track.cues.map((c) => ({ ...c, id: createId('cue') })) }));
  const copy: TimelineData = { id: newId, name: uniqueName(project, `${data.name} copy`), tracks: relinked, ...(markers ? { markers } : {}), ...(subtitles ? { subtitles } : {}), ...(data.mix ? { mix: data.mix } : {}) };
  return { ...project, timeline: activeTimeline(project), timelines: { ...project.timelines, [newId]: copy } };
};

export const removeTimeline = (id: string): Operation => (project) => {
  if (activeTimeline(project).id === id) throw new Error('Switch to another timeline before deleting this one');
  if (!project.timelines?.[id]) return project;
  const assetId = nestedAssetId(id);
  const { [id]: _gone, ...timelines } = project.timelines;
  const { [assetId]: _asset, ...assets } = project.assets;
  const strip = (tracks: readonly Track[]) => tracks.map((t) => (t.items.some((i) => usesAsset(i, assetId)) ? { ...t, items: t.items.filter((i) => !usesAsset(i, assetId)) } : t));
  return {
    ...project,
    assets,
    tracks: strip(project.tracks),
    timelines: Object.fromEntries(Object.entries(timelines).map(([k, v]) => [k, { ...v, tracks: strip(v.tracks) }])),
  };
};

const usesAsset = (item: Item, assetId: string) => item.kind === 'media' && item.source.assetId === assetId;

function contains(project: Project, timelineId: string, target: string, seen = new Set<string>()): boolean {
  if (timelineId === target) return true;
  if (seen.has(timelineId)) return false;
  seen.add(timelineId);
  const data = timelineData(project, timelineId);
  if (!data) return false;
  for (const track of data.tracks)
    for (const item of track.items) {
      const inner = item.kind === 'media' ? nestedTimelineOf(project, item.source.assetId) : null;
      if (inner && contains(project, inner, target, seen)) return true;
    }
  return false;
}

export const canNest = (project: Project, timelineId: string): boolean => !contains(project, timelineId, activeTimeline(project).id);

export const setTimelineFormat = (format: TimelineFormat): Operation => (project) => {
  const settings = formatSettings(project, format);
  return settings ? refreshNested({ ...project, settings }) : project;
};

function nestedMeta(project: Project, data: TimelineData): AssetMeta {
  const settings = data.settings ?? project.settings;
  return {
    id: nestedAssetId(data.id),
    name: data.name,
    size: 0,
    lastModified: 0,
    codec: 'Timeline',
    width: settings?.width ?? 1920,
    height: settings?.height ?? 1080,
    fps: settings?.fps ?? 25,
    start: 0,
    end: Math.max(MIN_NESTED_LENGTH, durationOf(project, data)),
    hasVideo: true,
    hasAudio: true,
    sampleRate: settings?.sampleRate ?? 48000,
    channels: 2,
    timeline: data.id,
  };
}

export const ensureNestedAsset = (timelineId: string): Operation => (project) => {
  const data = timelineData(project, timelineId);
  if (!data) throw new Error(`Unknown timeline ${timelineId}`);
  if (!canNest(project, timelineId)) throw new Error(`"${data.name}" contains this timeline and cannot be nested into it`);
  return refreshNested({ ...project, assets: { ...project.assets, [nestedAssetId(timelineId)]: nestedMeta(project, data) } });
};

function clampItems(tracks: readonly Track[], assets: Project['assets']): readonly Track[] {
  let changed = false;
  const out = tracks.map((track) => {
    let touched = false;
    const items = track.items.map((item) => {
      if (item.kind !== 'media') return item;
      const asset = assets[item.source.assetId];
      if (!asset?.timeline || item.source.out <= asset.end + 1e-9) return item;
      touched = true;
      const out = Math.max(asset.end, item.source.in + MIN_NESTED_LENGTH);
      const inPoint = Math.min(item.source.in, out - MIN_NESTED_LENGTH);
      return { ...item, source: { ...item.source, in: Math.max(0, inPoint), out } };
    });
    if (!touched) return track;
    changed = true;
    return { ...track, items };
  });
  return changed ? out : tracks;
}

export function refreshNested(project: Project): Project {
  let assets = project.assets;
  for (const asset of Object.values(project.assets)) {
    if (!asset.timeline) continue;
    const data = timelineData(project, asset.timeline);
    if (!data) continue;
    const meta = nestedMeta(project, data);
    if (meta.end !== asset.end || meta.name !== asset.name || meta.width !== asset.width || meta.height !== asset.height || meta.fps !== asset.fps) assets = { ...assets, [asset.id]: { ...asset, ...meta } };
  }
  if (assets === project.assets) return project;
  const tracks = clampItems(project.tracks, assets);
  const timelines = project.timelines && Object.fromEntries(Object.entries(project.timelines).map(([k, v]) => [k, { ...v, tracks: clampItems(v.tracks, assets) }]));
  return { ...project, assets, tracks, ...(timelines ? { timelines } : {}) };
}

export const nestItems = (itemIds: readonly string[], name?: string, id = createId('timeline'), itemId = createId('item')): Operation => (project) => {
  const picked = project.tracks.flatMap((track) => spansOf(track).filter((s) => itemIds.includes(s.item.id)).map((s) => ({ track, span: s })));
  if (!picked.length) throw new Error('Select clips to nest');
  const start = Math.min(...picked.map((p) => p.span.start));
  const end = Math.max(...picked.map((p) => p.span.start + itemLength(p.span.item)));
  const tracks = emptyTracks().map((t) => ({ ...t, items: [] as Item[] }));
  for (const original of project.tracks) if (!tracks.some((t) => t.id === original.id)) tracks.push({ ...original, items: [] });
  const ordered = tracks.map((t) => {
    const items = picked.filter((p) => p.track.id === t.id).map((p) => ({ ...p.span.item, start: p.span.start - start, transitionIn: null }));
    return { ...t, items };
  });
  const inner = ordered.map((t) => (t.magnetic ? { ...t, items: withGaps(t.items) } : t));
  const created = addTimeline(name ?? 'Compound clip', id, inner)(project);
  const lifted = picked.reduce((p, { track, span }) => liftRange([track.id], span.start, span.start + itemLength(span.item))(p), created);
  const withAsset = ensureNestedAsset(id)(lifted);
  const asset = withAsset.assets[nestedAssetId(id)];
  const target: EditTarget = {
    trackId: picked.some((p) => p.track.magnetic) ? picked.find((p) => p.track.magnetic)!.track.id : picked[0].track.id,
    item: {
      id: itemId,
      kind: 'media',
      start,
      effects: [],
      transitionIn: null,
      volume: 1,
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      animations: {},
      presets: {},
      source: { assetId: asset.id, in: 0, out: Math.min(asset.end, end - start) },
      speed: 1,
    },
  };
  return overwriteEdit([target], start)(withAsset);
};

function withGaps(items: readonly Item[]): Item[] {
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  const out: Item[] = [];
  let cursor = 0;
  for (const item of sorted) {
    const gap = item.start - cursor;
    out.push(gap > 1e-4 ? { ...item, gap } : item);
    cursor = placeTrack({ id: 'probe', kind: 'video', magnetic: true, muted: false, items: out }).at(-1)!.end;
  }
  return out;
}

