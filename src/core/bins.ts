import { createId } from './ids';
import type { AssetMeta, Bin, MediaEntry, MediaMetadata, Project } from './model';
import type { Operation } from './operations';

export const METADATA_FIELDS = ['scene', 'shot', 'take', 'angle', 'camera', 'reel', 'description', 'comments', 'keywords', 'rating', 'flagged'] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];
export type MetadataPatch = { [K in keyof MediaMetadata]?: MediaMetadata[K] | null };

export type MediaKind = 'video' | 'audio' | 'timeline';

export const mediaKind = (asset: AssetMeta): MediaKind => (asset.timeline ? 'timeline' : asset.hasVideo ? 'video' : 'audio');

export const binsOf = (project: Project): readonly Bin[] => project.bins ?? [];

export const entryOf = (project: Project, assetId: string): MediaEntry => project.media?.[assetId] ?? {};

const requireBin = (project: Project, id: string): Bin => {
  const bin = binsOf(project).find((b) => b.id === id);
  if (!bin) throw new Error(`No bin ${id}`);
  return bin;
};

function withMedia(project: Project, assetId: string, entry: MediaEntry): Project {
  const media = { ...project.media };
  const clean: MediaEntry = { ...(entry.bin ? { bin: entry.bin } : {}), ...(entry.metadata && Object.keys(entry.metadata).length ? { metadata: entry.metadata } : {}) };
  if (Object.keys(clean).length) media[assetId] = clean;
  else delete media[assetId];
  const { media: _old, ...rest } = project;
  return Object.keys(media).length ? { ...rest, media } : rest;
}

function withBins(project: Project, bins: readonly Bin[]): Project {
  const { bins: _old, ...rest } = project;
  return bins.length ? { ...rest, bins } : rest;
}

export const addBin = (name: string, parent: string | null = null, query?: string, id = createId('bin')): Operation => (project) => {
  const clean = name.trim();
  if (!clean) throw new Error('Bin name cannot be empty');
  if (parent) requireBin(project, parent);
  if (query !== undefined) parseQuery(query);
  return withBins(project, [...binsOf(project), { id, name: clean, parent, ...(query?.trim() ? { query: query.trim() } : {}) }]);
};

export const updateBin = (id: string, patch: { name?: string; parent?: string | null; query?: string | null }): Operation => (project) => {
  const bin = requireBin(project, id);
  if (patch.parent) {
    for (let at: string | null = patch.parent; at; at = requireBin(project, at).parent) if (at === id) throw new Error('A bin cannot be moved into itself');
  }
  if (patch.query) parseQuery(patch.query);
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new Error('Bin name cannot be empty');
  const { query: _query, ...rest } = bin;
  const query = patch.query === undefined ? bin.query : patch.query?.trim() || undefined;
  const next: Bin = { ...rest, ...(name ? { name } : {}), ...(patch.parent !== undefined ? { parent: patch.parent } : {}), ...(query ? { query } : {}) };
  return withBins(project, binsOf(project).map((b) => (b.id === id ? next : b)));
};

export const removeBin = (id: string): Operation => (project) => {
  const bin = requireBin(project, id);
  const bins = binsOf(project).filter((b) => b.id !== id).map((b) => (b.parent === id ? { ...b, parent: bin.parent } : b));
  let next = withBins(project, bins);
  for (const [assetId, entry] of Object.entries(project.media ?? {})) {
    if (entry.bin === id) next = withMedia(next, assetId, { ...entry, bin: bin.parent ?? undefined });
  }
  return next;
};

export const moveToBin = (assetIds: readonly string[], binId: string | null): Operation => (project) => {
  if (binId && requireBin(project, binId).query) throw new Error('Smart bins fill themselves from their search; media cannot be moved into them');
  return assetIds.reduce((p, assetId) => {
    if (!p.assets[assetId]) throw new Error(`No asset ${assetId}`);
    return withMedia(p, assetId, { ...entryOf(p, assetId), bin: binId ?? undefined });
  }, project);
};

function cleanValue(field: keyof MediaMetadata, value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (field === 'keywords') {
    if (!Array.isArray(value)) throw new Error('keywords must be a list of strings');
    const list = [...new Set(value.map((k) => String(k).trim()).filter(Boolean))];
    return list.length ? list : undefined;
  }
  if (field === 'rating') {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error('rating must be 0–5');
    return n || undefined;
  }
  if (field === 'flagged') return value ? true : undefined;
  const text = String(value).trim();
  return text || undefined;
}

export const setMetadata = (assetId: string, patch: MetadataPatch): Operation => (project) => {
  if (!project.assets[assetId]) throw new Error(`No asset ${assetId}`);
  const entry = entryOf(project, assetId);
  const metadata: Record<string, unknown> = { ...entry.metadata };
  for (const [key, value] of Object.entries(patch)) {
    if (!(METADATA_FIELDS as readonly string[]).includes(key)) throw new Error(`Unknown metadata field "${key}". Fields: ${METADATA_FIELDS.join(', ')}`);
    const clean = cleanValue(key as keyof MediaMetadata, value);
    if (clean === undefined) delete metadata[key];
    else metadata[key] = clean;
  }
  return withMedia(project, assetId, { ...entry, metadata: metadata as MediaMetadata });
};

export const renameAsset = (assetId: string, name: string): Operation => (project) => {
  const asset = project.assets[assetId];
  if (!asset) throw new Error(`No asset ${assetId}`);
  const clean = name.trim();
  if (!clean) throw new Error('Name cannot be empty');
  if (asset.timeline) throw new Error('Rename the timeline instead');
  return { ...project, assets: { ...project.assets, [assetId]: { ...asset, name: clean } } };
};

export function assetInUse(project: Project, assetId: string): boolean {
  const tracks = [...project.tracks, ...Object.values(project.timelines ?? {}).flatMap((t) => t.tracks)];
  return tracks.some((t) => t.items.some((i) => i.kind === 'media' && i.source.assetId === assetId));
}

export const removeAsset = (assetId: string): Operation => (project) => {
  const asset = project.assets[assetId];
  if (!asset) return project;
  if (asset.timeline) throw new Error('Delete the timeline instead');
  if (assetInUse(project, assetId)) throw new Error(`"${asset.name}" is used on a timeline`);
  const { [assetId]: _gone, ...assets } = project.assets;
  return withMedia({ ...project, assets }, assetId, {});
};

interface Term {
  readonly field: string | null;
  readonly op: ':' | '>=' | '<=' | '>' | '<' | '=';
  readonly value: string;
  readonly negate: boolean;
}

const TERM = /^(-)?(?:([a-z]+)(:|>=|<=|>|<|=))?(.+)$/i;
const SEARCH_FIELDS = ['name', 'codec', 'kind', 'bin', ...METADATA_FIELDS] as const;

export function parseQuery(query: string): Term[] {
  const tokens = query.match(/-?(?:[a-z]+(?::|>=|<=|>|<|=))?(?:"[^"]*"|\S+)/gi) ?? [];
  return tokens.map((token) => {
    const [, neg, field, op, raw] = TERM.exec(token)!;
    const value = raw.replace(/^"|"$/g, '').toLowerCase();
    if (field && !(SEARCH_FIELDS as readonly string[]).includes(field.toLowerCase())) throw new Error(`Unknown search field "${field}". Fields: ${SEARCH_FIELDS.join(', ')}`);
    return { field: field?.toLowerCase() ?? null, op: (op as Term['op']) ?? ':', value, negate: !!neg };
  });
}

function fieldValues(project: Project, asset: AssetMeta, field: string): string[] {
  const meta = entryOf(project, asset.id).metadata ?? {};
  if (field === 'name') return [asset.name];
  if (field === 'codec') return [asset.codec];
  if (field === 'kind') return [mediaKind(asset)];
  if (field === 'bin') {
    const id = entryOf(project, asset.id).bin;
    const bin = id ? binsOf(project).find((b) => b.id === id) : null;
    return bin ? [bin.name, bin.id] : [];
  }
  const value = meta[field as keyof MediaMetadata];
  if (value === undefined) return field === 'rating' ? ['0'] : field === 'flagged' ? ['no'] : [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
  return [String(value)];
}

function matches(project: Project, asset: AssetMeta, term: Term): boolean {
  const fields = term.field ? [term.field] : ['name', 'codec', 'kind', ...METADATA_FIELDS.filter((f) => f !== 'rating' && f !== 'flagged')];
  const values = fields.flatMap((f) => fieldValues(project, asset, f)).map((v) => v.toLowerCase());
  if (term.op === ':') return values.some((v) => v.includes(term.value));
  if (term.op === '=') return values.some((v) => v === term.value);
  const target = Number(term.value);
  return values.some((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isFinite(target)) return false;
    return term.op === '>=' ? n >= target : term.op === '<=' ? n <= target : term.op === '>' ? n > target : n < target;
  });
}

export function searchMedia(project: Project, query: string): AssetMeta[] {
  const terms = parseQuery(query);
  return Object.values(project.assets).filter((asset) => terms.every((term) => matches(project, asset, term) !== term.negate));
}

export function binContents(project: Project, binId: string | null): AssetMeta[] {
  if (binId) {
    const bin = requireBin(project, binId);
    if (bin.query) return searchMedia(project, bin.query);
  }
  return Object.values(project.assets).filter((a) => (entryOf(project, a.id).bin ?? null) === binId);
}
