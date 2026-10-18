import type { AssetMeta, Item, Project, Track } from './model';
import { IDENTITY_TRANSFORM } from './model';

type Loose<T> = { -readonly [K in keyof T]?: unknown };

function migrateItem(raw: Loose<Item> & Record<string, unknown>): Item {
  const base = {
    ...(raw as object),
    id: String(raw.id),
    start: Number(raw.start ?? 0),
    effects: (raw.effects as Item['effects']) ?? [],
    transitionIn: (raw.transitionIn as Item['transitionIn']) ?? null,
    volume: Number(raw.volume ?? 1),
    opacity: Number(raw.opacity ?? 1),
    transform: { ...IDENTITY_TRANSFORM, ...(raw.transform as object) },
    animations: (raw.animations as Item['animations']) ?? {},
    presets: (raw.presets as Item['presets']) ?? {},
  };
  if (raw.kind === 'text') return { ...base, kind: 'text', duration: Number(raw.duration), text: raw.text as never };
  return { ...base, kind: 'media', source: raw.source as never, speed: Number(raw.speed ?? 1) };
}

function migrateAsset(raw: AssetMeta & { hasVideo?: boolean }): AssetMeta {
  return { ...raw, hasVideo: raw.hasVideo ?? true };
}

export function migrateProject(raw: unknown): Project {
  const p = raw as { version?: number; settings?: Project['settings']; assets?: Record<string, AssetMeta>; tracks?: Track[]; stills?: Project['stills']; mix?: Project['mix']; markers?: Project['markers']; timeline?: Project['timeline']; bins?: Project['bins']; media?: Project['media']; timelines?: Record<string, { id: string; name: string; tracks: Track[]; markers?: Project['markers']; mix?: Project['mix'] }> };
  const migrateTracks = (list: Track[]) =>
    list.map((t) => ({
      id: t.id,
      kind: t.kind,
      magnetic: !!t.magnetic,
      muted: !!t.muted,
      items: t.items.map((i) => migrateItem(i as never)),
    }));
  const tracks = migrateTracks(p.tracks ?? []);
  const timelines = p.timelines && Object.fromEntries(Object.entries(p.timelines).map(([k, v]) => [k, { ...v, tracks: migrateTracks(v.tracks) }]));
  if ((p.version ?? 1) < 2 && !tracks.some((t) => t.kind === 'video' && !t.magnetic)) tracks.splice(1, 0, { id: 'v2', kind: 'video', magnetic: false, muted: false, items: [] });
  return {
    version: 2,
    settings: p.settings ?? null,
    assets: Object.fromEntries(Object.entries(p.assets ?? {}).map(([k, v]) => [k, migrateAsset(v)])),
    tracks,
    ...(p.stills ? { stills: p.stills } : {}),
    ...(p.mix ? { mix: p.mix } : {}),
    ...(p.markers?.length ? { markers: p.markers } : {}),
    ...(p.timeline ? { timeline: p.timeline } : {}),
    ...(p.bins?.length ? { bins: p.bins } : {}),
    ...(p.media && Object.keys(p.media).length ? { media: p.media } : {}),
    ...(timelines && Object.keys(timelines).length ? { timelines } : {}),
  };
}
