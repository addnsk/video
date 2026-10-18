import type { Project, TimelineData, Track } from './model';

export const MAIN_TIMELINE = 'timeline_main';
export const DEFAULT_TIMELINE_NAME = 'Timeline 1';
export const NESTED_PREFIX = 'timeline:';
export const activeTimeline = (project: Project) => project.timeline ?? { id: MAIN_TIMELINE, name: DEFAULT_TIMELINE_NAME };

export const nestedAssetId = (timelineId: string) => `${NESTED_PREFIX}${timelineId}`;

export const nestedTimelineOf = (project: Project, assetId: string): string | null => project.assets[assetId]?.timeline ?? null;

export function snapshot(project: Project): TimelineData {
  const { id, name } = activeTimeline(project);
  return { id, name, tracks: project.tracks, ...(project.markers ? { markers: project.markers } : {}), ...(project.mix ? { mix: project.mix } : {}) };
}

export function timelineData(project: Project, id: string): TimelineData | null {
  if (activeTimeline(project).id === id) return snapshot(project);
  return project.timelines?.[id] ?? null;
}

const prefixCache = new WeakMap<readonly Track[], Map<string, Project>>();

export function nestedProject(project: Project, assetId: string, prefix: string): Project | null {
  const timelineId = nestedTimelineOf(project, assetId);
  if (!timelineId) return null;
  const data = timelineData(project, timelineId);
  if (!data) return null;
  let byPrefix = prefixCache.get(data.tracks);
  if (!byPrefix) prefixCache.set(data.tracks, (byPrefix = new Map()));
  const cached = byPrefix.get(prefix);
  if (cached && cached.assets === project.assets && cached.timelines === project.timelines) return cached;
  const rename = (id: string) => `${prefix}>${id}`;
  const tracks = data.tracks.map((t) => ({ ...t, id: rename(t.id), items: t.items.map((i) => ({ ...i, id: rename(i.id), ...(i.link ? { link: rename(i.link) } : {}) })) }));
  const mix = data.mix && {
    ...data.mix,
    tracks: Object.fromEntries(Object.entries(data.mix.tracks).map(([k, v]) => [rename(k), v])),
  };
  const nested: Project = { ...project, tracks, ...(mix ? { mix } : { mix: undefined }), markers: data.markers };
  byPrefix.set(prefix, nested);
  return nested;
}
