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
  const p = raw as { version?: number; settings?: Project['settings']; assets?: Record<string, AssetMeta>; tracks?: Track[]; stills?: Project['stills'] };
  const tracks = (p.tracks ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    magnetic: !!t.magnetic,
    muted: !!t.muted,
    items: t.items.map((i) => migrateItem(i as never)),
  }));
  if (!tracks.some((t) => t.kind === 'video' && !t.magnetic)) tracks.splice(1, 0, { id: 'v2', kind: 'video', magnetic: false, muted: false, items: [] });
  return {
    version: 2,
    settings: p.settings ?? null,
    assets: Object.fromEntries(Object.entries(p.assets ?? {}).map(([k, v]) => [k, migrateAsset(v)])),
    tracks,
    ...(p.stills ? { stills: p.stills } : {}),
  };
}
