import type { MediaItem, Project, TimelineData, Track } from './model';

export const MAIN_TIMELINE = 'timeline_main';
export const DEFAULT_TIMELINE_NAME = 'Timeline 1';
export const NESTED_PREFIX = 'timeline:';
export const activeTimeline = (project: Project) => project.timeline ?? { id: MAIN_TIMELINE, name: DEFAULT_TIMELINE_NAME };

export const nestedAssetId = (timelineId: string) => `${NESTED_PREFIX}${timelineId}`;

export const nestedTimelineOf = (project: Project, assetId: string): string | null => project.assets[assetId]?.timeline ?? null;

export function snapshot(project: Project): TimelineData {
  const { id, name } = activeTimeline(project);
  return { id, name, tracks: project.tracks, ...(project.settings ? { settings: project.settings } : {}), ...(project.markers ? { markers: project.markers } : {}), ...(project.mix ? { mix: project.mix } : {}) };
}

export function timelineData(project: Project, id: string): TimelineData | null {
  if (activeTimeline(project).id === id) return snapshot(project);
  return project.timelines?.[id] ?? null;
}

const prefixCache = new WeakMap<readonly Track[], Map<string, Project>>();

export const angleTrack = (angle: number) => `cam${angle}`;
export const angleAudioTrack = (angle: number) => `cam${angle}a`;

function angleTracks(data: TimelineData, item: MediaItem): readonly Track[] {
  if (!data.multicam) return data.tracks;
  const count = data.multicam.angles.length;
  const video = Math.min(count - 1, Math.max(0, item.angle ?? 0));
  const audio = Math.min(count - 1, Math.max(0, item.audioAngle ?? video));
  return data.tracks.filter((t) => t.id === angleTrack(video) || t.id === angleAudioTrack(audio));
}

export function nestedProject(project: Project, item: MediaItem): Project | null {
  const prefix = item.id;
  const timelineId = nestedTimelineOf(project, item.source.assetId);
  if (!timelineId) return null;
  const data = timelineData(project, timelineId);
  if (!data) return null;
  let byPrefix = prefixCache.get(data.tracks);
  if (!byPrefix) prefixCache.set(data.tracks, (byPrefix = new Map()));
  const key = `${prefix}|${item.angle ?? ''}|${item.audioAngle ?? ''}`;
  const cached = byPrefix.get(key);
  if (cached && cached.assets === project.assets && cached.timelines === project.timelines) return cached;
  const rename = (id: string) => `${prefix}>${id}`;
  const tracks = angleTracks(data, item).map((t) => ({ ...t, id: rename(t.id), items: t.items.map((i) => ({ ...i, id: rename(i.id), ...(i.link ? { link: rename(i.link) } : {}) })) }));
  const mix = data.mix && {
    ...data.mix,
    tracks: Object.fromEntries(Object.entries(data.mix.tracks).map(([k, v]) => [rename(k), v])),
  };
  const nested: Project = { ...project, tracks, ...(mix ? { mix } : { mix: undefined }), markers: data.markers };
  byPrefix.set(key, nested);
  return nested;
}
