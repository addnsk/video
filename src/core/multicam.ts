import { createId } from './ids';
import type { Item, MediaItem, Project, TextItem, Track } from './model';
import { DEFAULT_TEXT, IDENTITY_TRANSFORM, itemLength } from './model';
import { createMediaItem, splitAt, updateItem, type Operation } from './operations';
import { findPlacement } from './timeline';
import { angleAudioTrack, angleTrack, nestedTimelineOf, timelineData } from './timeline-data';
import { addTimeline, ensureNestedAsset } from './timelines';

export interface AngleSource {
  readonly assetId: string;
  readonly offset?: number;
  readonly name?: string;
}

export const MAX_ANGLES = 16;

export const createMulticam = (name: string, sources: readonly AngleSource[], id = createId('timeline')): Operation => (project) => {
  if (sources.length < 2) throw new Error('A multicam clip needs at least two angles');
  if (sources.length > MAX_ANGLES) throw new Error(`A multicam clip holds at most ${MAX_ANGLES} angles`);
  const offsets = sources.map((s) => s.offset ?? 0);
  const base = Math.min(...offsets);
  const tracks: Track[] = [];
  const angles = sources.map((source, i) => {
    const asset = project.assets[source.assetId];
    if (!asset) throw new Error(`No asset ${source.assetId}`);
    if (!asset.hasVideo || asset.timeline) throw new Error(`"${asset.name}" has no picture of its own and cannot be an angle`);
    const start = offsets[i] - base;
    const item = createMediaItem(asset, { id: createId('item'), start });
    tracks.push({ id: angleTrack(i), kind: 'video', magnetic: false, muted: false, items: [asset.hasAudio ? { ...item, videoOnly: true } : item] });
    tracks.push({ id: angleAudioTrack(i), kind: 'audio', magnetic: false, muted: false, items: asset.hasAudio ? [{ ...item, id: createId('item') }] : [] });
    return { name: source.name?.trim() || asset.name, assetId: asset.id };
  });
  const created = addTimeline(name, id, tracks)(project);
  const data = created.timelines![id];
  const marked = { ...created, timelines: { ...created.timelines, [id]: { ...data, multicam: { angles } } } };
  return ensureNestedAsset(id)(marked);
};

export function multicamOf(project: Project, item: Item) {
  if (item.kind !== 'media') return null;
  const timeline = nestedTimelineOf(project, item.source.assetId);
  const data = timeline ? timelineData(project, timeline) : null;
  return data?.multicam ? { timeline: data.id, angles: data.multicam.angles } : null;
}

export const setAngle = (itemId: string, angle: { video?: number; audio?: number | null }): Operation => (project) => {
  const placement = findPlacement(project, itemId);
  if (!placement) throw new Error(`Unknown item ${itemId}`);
  const multicam = multicamOf(project, placement.item);
  if (!multicam) throw new Error('This clip is not a multicam clip');
  const check = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n >= multicam.angles.length) throw new Error(`Angle must be 0–${multicam.angles.length - 1}`);
    return n;
  };
  return updateItem(itemId, (item) => {
    const media = item as MediaItem;
    const { audioAngle: _a, ...rest } = media;
    const video = angle.video === undefined ? media.angle : check(angle.video);
    const audio = angle.audio === undefined ? media.audioAngle : angle.audio === null ? undefined : check(angle.audio);
    return { ...rest, ...(video !== undefined ? { angle: video } : {}), ...(audio !== undefined ? { audioAngle: audio } : {}) };
  })(project);
};

export const switchAngle = (time: number, trackId: string, angle: { video?: number; audio?: number | null }): Operation => (project) => {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown track ${trackId}`);
  const at = (p: Project) => findCovering(p, trackId, time);
  const before = at(project);
  if (!before) throw new Error('No multicam clip under the playhead');
  if (!multicamOf(project, before.item)) throw new Error('The clip under the playhead is not a multicam clip');
  const rightId = createId('item');
  const split = time - before.start > 1e-3 ? splitAt(time, trackId, rightId)(project) : project;
  const target = split === project ? before.item.id : at(split)?.item.id ?? before.item.id;
  return setAngle(target, angle)(split);
};

function findCovering(project: Project, trackId: string, time: number) {
  const track = project.tracks.find((t) => t.id === trackId)!;
  for (const item of track.items) {
    const p = findPlacement(project, item.id)!;
    if (time >= p.start - 1e-6 && time < p.end - 1e-6) return p;
  }
  return null;
}

export function multiviewProject(project: Project, assetId: string): Project {
  const timeline = nestedTimelineOf(project, assetId);
  const data = timeline ? timelineData(project, timeline) : null;
  if (!data?.multicam) throw new Error('Not a multicam clip');
  const count = data.multicam.angles.length;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const scale = 1 / Math.max(columns, rows);
  const tracks: Track[] = [];
  const labels: TextItem[] = [];
  data.multicam.angles.forEach((angle, i) => {
    const source = data.tracks.find((t) => t.id === angleTrack(i));
    const x = ((i % columns) + 0.5) * scale - 0.5;
    const y = (Math.floor(i / columns) + 0.5) * scale - 0.5;
    const transform = { ...IDENTITY_TRANSFORM, x, y, scale };
    const items = (source?.items ?? []).map((item) => ({ ...item, transform, effects: item.effects }));
    tracks.push({ id: `view${i}`, kind: 'video', magnetic: false, muted: false, items });
    const end = Math.max(0, ...items.map((item) => item.start + itemLength(item)));
    labels.push({
      id: `label${i}`,
      kind: 'text',
      start: 0,
      duration: Math.max(1 / 120, end),
      effects: [],
      transitionIn: null,
      volume: 1,
      opacity: 1,
      transform: { ...IDENTITY_TRANSFORM, x, y: y + scale * 0.4 },
      animations: {},
      presets: {},
      text: { ...DEFAULT_TEXT, content: `${i + 1}  ${angle.name}`, size: 0.035, background: '#000000a0' },
    });
  });
  tracks.push({ id: 'labels', kind: 'video', magnetic: false, muted: false, items: labels });
  const audio = data.tracks.filter((t) => t.kind === 'audio' && t.id === angleAudioTrack(0));
  const { mix: _mix, markers: _markers, ...rest } = project;
  return { ...rest, tracks: [...tracks, ...audio] };
}
