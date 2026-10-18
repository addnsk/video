import { shiftAnimations } from './animation';
import { createId } from './ids';
import type { Item, MediaItem, Marker, Project, Track } from './model';
import { MAX_SPEED, MIN_SPEED, accepts, itemLength } from './model';
import { MIN_LENGTH, createMediaItem, splitItem, type Operation } from './operations';
import { placeTrack } from './timeline';

export const EDIT_EPSILON = 1e-4;

export interface Span {
  readonly item: Item;
  readonly start: number;
}

export type Edge = 'in' | 'out';

export type RippleScope = 'track' | 'linked' | 'all' | readonly string[];

const spanEnd = (s: Span) => s.start + itemLength(s.item);

export const spansOf = (track: Track): Span[] => placeTrack(track).map((p) => ({ item: p.item, start: p.start }));

function withoutGap(item: Item): Item {
  if (item.gap === undefined) return item;
  const { gap: _gap, ...rest } = item;
  return rest as Item;
}

export function trackFromSpans(track: Track, spans: readonly Span[]): Track {
  if (!track.magnetic) return { ...track, items: spans.map((s) => ({ ...withoutGap(s.item), start: Math.max(0, s.start) })) };
  const ordered = spans.slice().sort((a, b) => a.start - b.start);
  const items: Item[] = [];
  let cursor = 0;
  for (const span of ordered) {
    const gap = span.start - cursor;
    const placed = gap > EDIT_EPSILON ? { ...withoutGap(span.item), start: Math.max(0, span.start), gap } : { ...withoutGap(span.item), start: Math.max(0, span.start) };
    items.push(placed);
    cursor = placeTrack({ ...track, items }).at(-1)!.end;
  }
  return { ...track, items };
}

export function splitSpans(track: Track, spans: readonly Span[], time: number): Span[] {
  const out: Span[] = [];
  const cutTransition = track.magnetic ? overlapAt(spans, time) : null;
  for (const span of spans) {
    const local = time - span.start;
    const length = itemLength(span.item);
    if (local <= MIN_LENGTH - EDIT_EPSILON || length - local <= MIN_LENGTH - EDIT_EPSILON) {
      out.push(span);
      continue;
    }
    const [left, right] = splitItem(span.item, span.start, local);
    if (cutTransition?.outgoing === span) out.push({ item: left, start: span.start });
    else if (cutTransition?.incoming === span) out.push({ item: right, start: time });
    else out.push({ item: left, start: span.start }, { item: right, start: time });
  }
  return out;
}

function overlapAt(spans: readonly Span[], time: number): { outgoing: Span; incoming: Span } | null {
  const covering = spans.filter((s) => time > s.start + EDIT_EPSILON && time < spanEnd(s) - EDIT_EPSILON);
  return covering.length === 2 ? { outgoing: covering[0], incoming: covering[1] } : null;
}

const within = (s: Span, a: number, b: number) => s.start >= a - EDIT_EPSILON && spanEnd(s) <= b + EDIT_EPSILON;

export function cutRange(track: Track, spans: readonly Span[], a: number, b: number): Span[] {
  return splitSpans(track, splitSpans(track, spans, a), b).filter((s) => !within(s, a, b));
}

const shiftFrom = (spans: readonly Span[], time: number, delta: number): Span[] =>
  spans.map((s) => (s.start >= time - EDIT_EPSILON ? { ...s, start: s.start + delta } : s));

function mapTrack(project: Project, trackId: string, fn: (track: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

const editSpans = (project: Project, trackId: string, fn: (spans: Span[], track: Track) => Span[]): Project =>
  mapTrack(project, trackId, (track) => trackFromSpans(track, fn(spansOf(track), track)));

function shiftMarkers(project: Project, time: number, delta: number, drop?: readonly [number, number]): Project {
  if (!project.markers?.length) return project;
  const markers = project.markers
    .filter((m) => !drop || m.time < drop[0] - EDIT_EPSILON || m.time >= drop[1] - EDIT_EPSILON)
    .map((m) => (m.time >= time - EDIT_EPSILON ? { ...m, time: Math.max(0, m.time + delta) } : m));
  return withMarkers(project, markers);
}

function locate(project: Project, itemId: string): { track: Track; span: Span } {
  for (const track of project.tracks) {
    const span = spansOf(track).find((s) => s.item.id === itemId);
    if (span) return { track, span };
  }
  throw new Error(`Unknown item ${itemId}`);
}

export function linkedIds(project: Project, itemId: string): string[] {
  const { span } = locate(project, itemId);
  const link = span.item.link;
  if (!link) return [itemId];
  return [itemId, ...project.tracks.flatMap((t) => t.items).filter((i) => i.link === link && i.id !== itemId).map((i) => i.id)];
}

function scopeTracks(project: Project, scope: RippleScope, primary: readonly string[]): string[] {
  if (scope === 'all') return project.tracks.map((t) => t.id);
  if (scope === 'track' || scope === 'linked') return [...new Set(primary)];
  return [...new Set([...primary, ...scope])];
}

const tracksOf = (project: Project, itemIds: readonly string[]) => itemIds.map((id) => locate(project, id).track.id);

export const openGap = (trackIds: readonly string[], time: number, length: number): Operation => (project) =>
  shiftMarkers(
    trackIds.reduce((p, id) => editSpans(p, id, (spans, track) => shiftFrom(splitSpans(track, spans, time), time, length)), project),
    time,
    length,
  );

export const liftRange = (trackIds: readonly string[], a: number, b: number): Operation => (project) =>
  b - a <= EDIT_EPSILON ? project : trackIds.reduce((p, id) => editSpans(p, id, (spans, track) => cutRange(track, spans, a, b)), project);

export const extractRange = (trackIds: readonly string[], a: number, b: number): Operation => (project) =>
  b - a <= EDIT_EPSILON
    ? project
    : shiftMarkers(
        trackIds.reduce((p, id) => editSpans(p, id, (spans, track) => shiftFrom(cutRange(track, spans, a, b), b, a - b)), project),
        b,
        a - b,
        [a, b],
      );

export interface EditTarget {
  readonly trackId: string;
  readonly item: Item;
}

const placeSpan = (target: EditTarget, time: number): Operation => (project) => {
  const track = project.tracks.find((t) => t.id === target.trackId);
  if (!track) throw new Error(`Unknown track ${target.trackId}`);
  if (!accepts(track, target.item, project.assets)) throw new Error(`Track ${track.id} cannot hold this item`);
  return editSpans(project, track.id, (spans) => [...spans, { item: { ...target.item, transitionIn: null }, start: time }]);
};

const editLength = (targets: readonly EditTarget[]) => Math.max(...targets.map((t) => itemLength(t.item)));

export const insertEdit = (targets: readonly EditTarget[], time: number, scope: RippleScope = 'all'): Operation => (project) => {
  const at = Math.max(0, time);
  const opened = openGap(scopeTracks(project, scope, targets.map((t) => t.trackId)), at, editLength(targets))(project);
  return targets.reduce((p, target) => placeSpan(target, at)(p), opened);
};

export const overwriteEdit = (targets: readonly EditTarget[], time: number): Operation => (project) => {
  const at = Math.max(0, time);
  return targets.reduce((p, target) => placeSpan(target, at)(liftRange([target.trackId], at, at + itemLength(target.item))(p)), project);
};

export const deleteItems = (itemIds: readonly string[], ripple: boolean, scope: RippleScope = 'linked'): Operation => (project) => {
  const ids = [...new Set(itemIds.flatMap((id) => linkedIds(project, id)))];
  const located = ids.map((id) => locate(project, id));
  let next = ids.reduce((p, id) => removeSpan(p, id), project);
  if (!ripple || !located.length) return next;
  const ranges = mergeRanges(located.map(({ span }) => [span.start, spanEnd(span)] as const));
  const tracks = scopeTracks(project, scope, located.map((l) => l.track.id));
  for (const [a, b] of ranges.reverse()) next = extractRange(tracks, a, b)(next);
  return next;
};

function removeSpan(project: Project, itemId: string): Project {
  const { track } = locate(project, itemId);
  return editSpans(project, track.id, (spans) => spans.filter((s) => s.item.id !== itemId));
}

function mergeRanges(ranges: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = ranges.slice().sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + EDIT_EPSILON) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function edgeRange(item: Item, edge: Edge, project: Project): readonly [number, number] {
  const length = itemLength(item);
  if (item.kind === 'text') return edge === 'in' ? [-Infinity, length - MIN_LENGTH] : [MIN_LENGTH - length, Infinity];
  const asset = project.assets[item.source.assetId];
  const lo = asset?.start ?? -Infinity;
  const hi = asset?.end ?? Infinity;
  const room = (item.source.out - item.source.in - MIN_LENGTH) / item.speed;
  if (edge === 'in') return [(lo - item.source.in) / item.speed, room];
  return [-room, (hi - item.source.out) / item.speed];
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => (lo > hi ? 0 : Math.min(Math.max(0, hi), Math.max(Math.min(0, lo), v)));

const intersect = (...ranges: (readonly [number, number])[]): [number, number] => [
  Math.max(...ranges.map((r) => r[0])),
  Math.min(...ranges.map((r) => r[1])),
];

export function moveEdge(item: Item, edge: Edge, delta: number): Item {
  if (!delta) return item;
  const length = itemLength(item);
  if (edge === 'out') {
    if (item.kind === 'text') return { ...item, duration: length + delta, animations: shiftAnimations(item.animations, 0, length + delta) };
    return { ...item, source: { ...item.source, out: item.source.out + delta * item.speed }, animations: delta < 0 ? shiftAnimations(item.animations, 0, length + delta) : item.animations };
  }
  const animations = shiftAnimations(item.animations, delta, length - delta);
  if (item.kind === 'text') return { ...item, duration: length - delta, animations };
  return { ...item, source: { ...item.source, in: item.source.in + delta * item.speed }, animations };
}

type SpanEdit = (span: Span) => Span;

function replaceSpans(project: Project, edits: ReadonlyMap<string, SpanEdit>): Project {
  return project.tracks.reduce(
    (p, track) =>
      track.items.some((i) => edits.has(i.id)) ? editSpans(p, track.id, (spans) => spans.map((s) => edits.get(s.item.id)?.(s) ?? s)) : p,
    project,
  );
}

export const rippleTrim = (itemId: string, edge: Edge, delta: number, scope: RippleScope = 'linked'): Operation => (project) => {
  const ids = linkedIds(project, itemId);
  const applied = clamp(delta, intersect(...ids.map((id) => edgeRange(locate(project, id).span.item, edge, project))));
  if (!applied) return project;
  const change = edge === 'out' ? applied : -applied;
  const pivot = spanEnd(locate(project, itemId).span);
  const next = scopeTracks(project, scope, tracksOf(project, ids)).reduce(
    (p, id) =>
      editSpans(p, id, (list) =>
        list.map((s) => {
          if (ids.includes(s.item.id)) return { item: moveEdge(s.item, edge, applied), start: s.start };
          return s.start >= pivot - EDIT_EPSILON ? { ...s, start: s.start + change } : s;
        }),
      ),
    project,
  );
  return shiftMarkers(next, pivot, change);
};

function neighbor(track: Track, span: Span, edge: Edge): Span | null {
  const spans = spansOf(track);
  if (track.magnetic) {
    const index = spans.findIndex((s) => s.item.id === span.item.id);
    const right = edge === 'out' ? spans[index + 1] : span;
    const other = edge === 'out' ? spans[index + 1] : spans[index - 1];
    return other && right && !right.item.gap ? other : null;
  }
  if (edge === 'out') return spans.find((s) => s.item.id !== span.item.id && Math.abs(s.start - spanEnd(span)) <= EDIT_EPSILON) ?? null;
  return spans.find((s) => s.item.id !== span.item.id && Math.abs(spanEnd(s) - span.start) <= EDIT_EPSILON) ?? null;
}

interface EditPoint {
  readonly left: Span;
  readonly right: Span;
}

function editPoint(project: Project, itemId: string, edge: Edge): EditPoint | null {
  const { track, span } = locate(project, itemId);
  const other = neighbor(track, span, edge);
  if (!other) return null;
  return edge === 'out' ? { left: span, right: other } : { left: other, right: span };
}

const pointRange = (project: Project, point: EditPoint) => intersect(edgeRange(point.left.item, 'out', project), edgeRange(point.right.item, 'in', project));

const rollEdits = (point: EditPoint, delta: number): [string, SpanEdit][] => [
  [point.left.item.id, (s) => ({ ...s, item: moveEdge(s.item, 'out', delta) })],
  [point.right.item.id, (s) => ({ item: moveEdge(s.item, 'in', delta), start: s.start + delta })],
];

export const rollEdit = (itemId: string, edge: Edge, delta: number): Operation => (project) => {
  const points = linkedIds(project, itemId)
    .map((id) => editPoint(project, id, edge))
    .filter((p): p is EditPoint => !!p);
  if (!points.length) return project;
  const applied = clamp(delta, intersect(...points.map((p) => pointRange(project, p))));
  if (!applied) return project;
  return replaceSpans(project, new Map(points.flatMap((point) => rollEdits(point, applied))));
};

export const slipEdit = (itemId: string, delta: number): Operation => (project) => {
  const ids = linkedIds(project, itemId);
  const items = ids.map((id) => locate(project, id).span.item).filter((i) => i.kind === 'media');
  if (!items.length) return project;
  const applied = clamp(delta, intersect(...items.map((item) => {
    const [lo] = edgeRange(item, 'in', project);
    const [, hi] = edgeRange(item, 'out', project);
    return [lo, hi] as const;
  })));
  if (!applied) return project;
  const slip: SpanEdit = (s) =>
    s.item.kind === 'media' ? { ...s, item: { ...s.item, source: { ...s.item.source, in: s.item.source.in + applied * s.item.speed, out: s.item.source.out + applied * s.item.speed } } } : s;
  return replaceSpans(project, new Map(items.map((item) => [item.id, slip])));
};

export const slideEdit = (itemId: string, delta: number): Operation => (project) => {
  const ids = linkedIds(project, itemId);
  const plans = ids.map((id) => {
    const { track, span } = locate(project, id);
    return { span, before: neighbor(track, span, 'in'), after: neighbor(track, span, 'out') };
  });
  const ranges: (readonly [number, number])[] = [[-plans.reduce((m, p) => Math.min(m, p.span.start), Infinity), Infinity]];
  for (const { before, after } of plans) {
    if (before) ranges.push(edgeRange(before.item, 'out', project));
    if (after) ranges.push(edgeRange(after.item, 'in', project));
  }
  const applied = clamp(delta, intersect(...ranges));
  if (!applied) return project;
  const edits = new Map<string, SpanEdit>();
  for (const { span, before, after } of plans) {
    if (before) edits.set(before.item.id, (s) => ({ ...s, item: moveEdge(s.item, 'out', applied) }));
    if (after) edits.set(after.item.id, (s) => ({ item: moveEdge(s.item, 'in', applied), start: s.start + applied }));
    edits.set(span.item.id, (s) => ({ ...s, start: s.start + applied }));
  }
  return replaceSpans(project, edits);
};

export const linkItems = (itemIds: readonly string[], link: string | null = createId('link')): Operation => (project) => {
  const set = new Set(itemIds);
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.items.some((i) => set.has(i.id))
        ? {
            ...track,
            items: track.items.map((i) => {
              if (!set.has(i.id)) return i;
              const { link: _old, ...rest } = i;
              return (link ? { ...rest, link } : rest) as Item;
            }),
          }
        : track,
    ),
  };
};

export const unlinkItems = (itemIds: readonly string[]): Operation => linkItems(itemIds, null);

const MARKER_COLORS = ['blue', 'cyan', 'green', 'yellow', 'red', 'pink', 'purple', 'fuchsia', 'rose', 'lavender', 'sky', 'mint', 'lemon', 'sand', 'cocoa', 'cream'] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];
export const markerColors = (): readonly string[] => MARKER_COLORS;

export const addMarker = (marker: Partial<Omit<Marker, 'id'>> & { time: number }, id = createId('marker')): Operation => (project) => {
  const color = marker.color ?? 'blue';
  if (!(MARKER_COLORS as readonly string[]).includes(color)) throw new Error(`Unknown marker color "${color}". Available: ${MARKER_COLORS.join(', ')}`);
  const entry: Marker = { id, time: Math.max(0, marker.time), duration: Math.max(0, marker.duration ?? 0), name: marker.name ?? '', color, note: marker.note ?? '' };
  return { ...project, markers: [...(project.markers ?? []), entry].sort((a, b) => a.time - b.time) };
};

export const updateMarker = (id: string, patch: Partial<Omit<Marker, 'id'>>): Operation => (project) => {
  if (patch.color && !(MARKER_COLORS as readonly string[]).includes(patch.color)) throw new Error(`Unknown marker color "${patch.color}". Available: ${MARKER_COLORS.join(', ')}`);
  const markers = (project.markers ?? []).map((m) => (m.id === id ? { ...m, ...patch, time: Math.max(0, patch.time ?? m.time), duration: Math.max(0, patch.duration ?? m.duration) } : m));
  return { ...project, markers: markers.sort((a, b) => a.time - b.time) };
};

function withMarkers(project: Project, markers: readonly Marker[]): Project {
  const { markers: _old, ...rest } = project;
  return markers.length ? { ...rest, markers: markers.slice().sort((a, b) => a.time - b.time) } : rest;
}

export const removeMarker = (id: string): Operation => (project) => {
  const markers = (project.markers ?? []).filter((m) => m.id !== id);
  return markers.length === (project.markers ?? []).length ? project : withMarkers(project, markers);
};

export interface ClipRequest {
  readonly assetId: string;
  readonly sourceIn: number;
  readonly sourceOut: number;
  readonly speed?: number;
  readonly videoTrack?: string | null;
  readonly audioTrack?: string | null;
}

export function clipTargets(project: Project, request: ClipRequest, ids: { video?: string; audio?: string } = {}): EditTarget[] {
  const asset = project.assets[request.assetId];
  if (!asset) throw new Error(`Unknown asset ${request.assetId}`);
  const video = asset.hasVideo && request.videoTrack ? request.videoTrack : null;
  const audio = asset.hasAudio && request.audioTrack ? request.audioTrack : null;
  if (!video && !audio) throw new Error('No track to edit into');
  const link = video && audio ? createId('link') : undefined;
  const make = (id: string | undefined, extra: Partial<MediaItem>): MediaItem => ({
    ...createMediaItem(asset, { in: request.sourceIn, out: request.sourceOut, id }),
    speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, request.speed ?? 1)),
    ...(link ? { link } : {}),
    ...extra,
  });
  const targets: EditTarget[] = [];
  if (video) targets.push({ trackId: video, item: make(ids.video, audio ? { videoOnly: true } : {}) });
  if (audio) targets.push({ trackId: audio, item: make(ids.audio, {}) });
  return targets;
}
