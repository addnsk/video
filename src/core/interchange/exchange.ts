import { trackFromSpans, type Span } from '../editing';
import { createId } from '../ids';
import { DEFAULT_TEXT, carriesAudio, type AssetMeta, type Item, type MediaItem, type Project, type TextItem, type Track, type TrackKind } from '../model';
import { baseItem, MIN_LENGTH, type Operation } from '../operations';
import { placeTrack } from '../timeline';
import { activeTimeline, nestedAssetId, nestedTimelineOf, timelineData } from '../timeline-data';
import { addTimeline, ensureNestedAsset, switchTimeline } from '../timelines';

export interface ExchangeMedia {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly start: number;
  readonly duration: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface ExchangeClip {
  readonly name: string;
  readonly media?: string;
  readonly sequence?: string;
  readonly text?: string;
  readonly start: number;
  readonly duration: number;
  readonly in: number;
  readonly speed: number;
  readonly transition: number;
  readonly enabled: boolean;
  readonly adjust?: ExchangeAdjust;
}

export interface ExchangeAdjust {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly volume: number;
}

export const NEUTRAL_ADJUST: ExchangeAdjust = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 };

export const isNeutral = (a: ExchangeAdjust | undefined) => !a || (Object.keys(NEUTRAL_ADJUST) as (keyof ExchangeAdjust)[]).every((k) => Math.abs(a[k] - NEUTRAL_ADJUST[k]) < 1e-6);

export interface ExchangeTrack {
  readonly kind: TrackKind;
  readonly name: string;
  readonly clips: readonly ExchangeClip[];
}

export interface ExchangeMarker {
  readonly time: number;
  readonly duration: number;
  readonly name: string;
  readonly note: string;
  readonly color: string;
}

export interface ExchangeSequence {
  readonly id: string;
  readonly name: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly sampleRate: number;
  readonly tracks: readonly ExchangeTrack[];
  readonly markers: readonly ExchangeMarker[];
}

export interface Exchange {
  readonly main: ExchangeSequence;
  readonly sequences: Readonly<Record<string, ExchangeSequence>>;
  readonly media: Readonly<Record<string, ExchangeMedia>>;
}

export const clipEnd = (clip: ExchangeClip) => clip.start + clip.duration;

export const sequenceDuration = (sequence: ExchangeSequence) => Math.max(0, ...sequence.tracks.flatMap((t) => t.clips.map(clipEnd)));

const TRACK_NAMES: Record<TrackKind, string> = { video: 'V', audio: 'A' };

export function exchangeFromProject(project: Project, timelineId = activeTimeline(project).id): Exchange {
  const media: Record<string, ExchangeMedia> = {};
  const sequences: Record<string, ExchangeSequence> = {};
  const visit = (id: string): ExchangeSequence => {
    const data = timelineData(project, id);
    if (!data) throw new Error(`Unknown timeline ${id}`);
    const settings = data.settings ?? project.settings;
    const fps = settings?.fps ?? 25;
    const video: ExchangeTrack[] = [];
    const embedded: ExchangeTrack[] = [];
    const audio: ExchangeTrack[] = [];
    const clipOf = (item: Item, start: number, end: number, fadeIn: number, enabled: boolean): ExchangeClip => {
      const adjust = { x: item.transform.x, y: item.transform.y, scale: item.transform.scale, rotation: item.transform.rotation, opacity: item.opacity, volume: item.volume };
      const base = { start, duration: end - start, transition: fadeIn, enabled, ...(isNeutral(adjust) ? {} : { adjust }) };
      if (item.kind === 'text') return { ...base, name: item.text.content.split('\n')[0] || 'Title', text: item.text.content, in: 0, speed: 1 };
      const asset = project.assets[item.source.assetId];
      const inner = nestedTimelineOf(project, item.source.assetId);
      if (inner) {
        if (!sequences[inner] && inner !== id) sequences[inner] = visit(inner);
        return { ...base, name: asset?.name ?? inner, sequence: inner, in: item.source.in, speed: item.speed };
      }
      if (asset && !media[asset.id]) media[asset.id] = mediaOf(asset);
      return { ...base, name: asset?.name ?? item.source.assetId, media: item.source.assetId, in: item.source.in, speed: item.speed };
    };
    for (const track of data.tracks) {
      const placements = placeTrack(track);
      const index = (track.kind === 'video' ? video : audio).length + 1;
      const name = `${TRACK_NAMES[track.kind]}${index}`;
      const clips = placements.map((p) => clipOf(p.item, p.start, p.end, p.fadeIn, !track.muted));
      (track.kind === 'video' ? video : audio).push({ kind: track.kind, name, clips });
      if (track.kind !== 'video') continue;
      const sound = placements.filter(({ item }) => item.kind === 'media' && !item.videoOnly && (!!nestedTimelineOf(project, item.source.assetId) || carriesAudio(item, project.assets)));
      if (sound.length) embedded.push({ kind: 'audio', name: `${name} audio`, clips: sound.map((p) => clipOf(p.item, p.start, p.end, p.fadeIn, !track.muted)) });
    }
    const markers = (data.markers ?? []).map(({ time, duration, name, note, color }) => ({ time, duration, name, note, color }));
    return { id, name: data.name, fps, width: settings?.width ?? 1920, height: settings?.height ?? 1080, sampleRate: settings?.sampleRate ?? 48000, tracks: [...video, ...embedded, ...audio], markers };
  };
  const main = visit(timelineId);
  return { main, sequences, media };
}

const mediaOf = (asset: AssetMeta): ExchangeMedia => ({
  id: asset.id,
  name: asset.name,
  start: asset.start,
  duration: asset.end - asset.start,
  fps: asset.fps || 25,
  width: asset.width,
  height: asset.height,
  hasVideo: asset.hasVideo,
  hasAudio: asset.hasAudio,
  sampleRate: asset.sampleRate || 48000,
  channels: asset.channels || 2,
});

export interface ImportResult {
  readonly timeline: string;
  readonly placeholders: readonly string[];
  readonly matched: readonly string[];
}

const baseName = (path: string) => decodeURIComponent(path.split(/[\\/]/).pop() ?? path);
const key = (name: string) => name.trim().toLowerCase();

function findAsset(project: Project, media: ExchangeMedia): AssetMeta | null {
  const names = new Set([key(media.name), ...(media.path ? [key(baseName(media.path))] : [])]);
  return Object.values(project.assets).find((a) => !a.timeline && names.has(key(a.name))) ?? null;
}

function mediaUse(exchange: Exchange) {
  const use = new Map<string, { end: number; video: boolean; audio: boolean }>();
  for (const sequence of [exchange.main, ...Object.values(exchange.sequences)])
    for (const track of sequence.tracks)
      for (const clip of track.clips) {
        if (!clip.media) continue;
        const entry = use.get(clip.media) ?? { end: 0, video: false, audio: false };
        entry.end = Math.max(entry.end, clip.in + clip.duration * clip.speed);
        if (track.kind === 'video') entry.video = true;
        else entry.audio = true;
        use.set(clip.media, entry);
      }
  return use;
}

function placeholder(media: ExchangeMedia, use: { end: number; video: boolean; audio: boolean } | undefined, fallback: ExchangeSequence): AssetMeta {
  const end = Math.max(media.start + media.duration, use?.end ?? 0, media.start + MIN_LENGTH);
  return {
    id: createId('asset'),
    name: media.path ? baseName(media.path) : media.name,
    size: 0,
    lastModified: 0,
    codec: '',
    width: media.width || fallback.width,
    height: media.height || fallback.height,
    fps: media.fps || fallback.fps,
    start: media.start,
    end,
    hasVideo: media.hasVideo || !!use?.video,
    hasAudio: media.hasAudio || !!use?.audio,
    sampleRate: media.sampleRate || 48000,
    channels: media.channels || 2,
    placeholder: true,
  };
}

const NEAR = 1e-3;

function buildTracks(sequence: ExchangeSequence, resolve: (clip: ExchangeClip) => string | null): Track[] {
  const items = new Map<ExchangeClip, Item>();
  const make = (clip: ExchangeClip): Item | null => {
    const start = Math.max(0, clip.start);
    const adjust = clip.adjust ?? NEUTRAL_ADJUST;
    const shared = {
      ...baseItem(createId('item'), start),
      transitionIn: clip.transition > 0 ? { type: 'dissolve', duration: clip.transition, params: {} } : null,
      transform: { x: adjust.x, y: adjust.y, scale: adjust.scale, rotation: adjust.rotation },
      opacity: adjust.opacity,
      volume: adjust.volume,
    };
    if (clip.text !== undefined && !clip.media && !clip.sequence) {
      const text: TextItem = { ...shared, kind: 'text', duration: Math.max(MIN_LENGTH, clip.duration), text: { ...DEFAULT_TEXT, content: clip.text } };
      return text;
    }
    const assetId = resolve(clip);
    if (!assetId || clip.duration < MIN_LENGTH) return null;
    const speed = clip.speed > 0 ? clip.speed : 1;
    const item: MediaItem = { ...shared, kind: 'media', source: { assetId, in: clip.in, out: clip.in + clip.duration * speed }, speed, videoOnly: true };
    return item;
  };
  for (const track of sequence.tracks) for (const clip of track.clips) {
    const item = make(clip);
    if (item) items.set(clip, item);
  }
  const videoTracks = sequence.tracks.filter((t) => t.kind === 'video');
  const audioTracks = sequence.tracks.filter((t) => t.kind === 'audio');
  const pairs = new Map<ExchangeClip, ExchangeClip>();
  const used = new Set<ExchangeClip>();
  for (const track of videoTracks)
    for (const clip of track.clips) {
      const sameSource = (other: ExchangeClip) => other !== clip && !used.has(other) && (other.media ?? other.sequence) === (clip.media ?? clip.sequence) && !!(clip.media ?? clip.sequence) && Math.abs(other.start - clip.start) < NEAR && Math.abs(other.duration - clip.duration) < NEAR && Math.abs(other.in - clip.in) < NEAR;
      const partner = audioTracks.flatMap((t) => t.clips).find(sameSource);
      if (partner) {
        pairs.set(clip, partner);
        used.add(partner);
      }
    }
  for (const [video, sound] of pairs) {
    const item = items.get(video);
    if (!item || item.kind !== 'media' || !items.has(sound)) continue;
    items.set(video, { ...item, videoOnly: undefined });
    items.delete(sound);
  }
  for (const track of audioTracks)
    for (const clip of track.clips) {
      const item = items.get(clip);
      if (item?.kind === 'media') items.set(clip, { ...item, videoOnly: undefined });
    }

  const tracks: Track[] = [];
  const main: Span[] = [];
  const overflow: Span[][] = [];
  const spansOfTrack = (track: ExchangeTrack) => track.clips.flatMap((c) => (items.has(c) ? [{ item: items.get(c)!, start: Math.max(0, c.start) }] : []));
  const [first, ...rest] = videoTracks;
  if (first) {
    let cursor = 0;
    for (const span of spansOfTrack(first).sort((a, b) => a.start - b.start)) {
      const overlap = cursor - span.start;
      const fade = span.item.transitionIn?.duration ?? 0;
      if (overlap > NEAR && Math.abs(overlap - fade) > NEAR) {
        (overflow[0] ??= []).push({ item: { ...span.item, transitionIn: null }, start: span.start });
        continue;
      }
      const item = fade && Math.abs(overlap - fade) > NEAR ? { ...span.item, transitionIn: null } : span.item;
      main.push({ item, start: span.start });
      cursor = span.start + itemLengthOf(item);
    }
  }
  const magnetic: Track = { id: 'v1', kind: 'video', magnetic: true, muted: first ? first.clips.every((c) => !c.enabled) && first.clips.length > 0 : false, items: [] };
  tracks.push(trackFromSpans(magnetic, main));
  const loose = (kind: TrackKind, spans: Span[], muted: boolean): Track => ({ id: '', kind, magnetic: false, muted, items: spans.map((s) => ({ ...s.item, transitionIn: null, start: s.start })).sort((a, b) => a.start - b.start) });
  const videos = [...(overflow[0] ? [loose('video', overflow[0], false)] : []), ...rest.map((t) => loose('video', spansOfTrack(t), t.clips.length > 0 && t.clips.every((c) => !c.enabled)))];
  if (!videos.length) videos.push(loose('video', [], false));
  const audios = audioTracks.map((t) => loose('audio', spansOfTrack(t), t.clips.length > 0 && t.clips.every((c) => !c.enabled)));
  if (!audios.length) audios.push(loose('audio', [], false));
  videos.forEach((t, i) => tracks.push({ ...t, id: `v${i + 2}` }));
  audios.forEach((t, i) => tracks.push({ ...t, id: `a${i + 1}` }));
  return tracks;
}

const itemLengthOf = (item: Item) => (item.kind === 'media' ? (item.source.out - item.source.in) / item.speed : item.duration);

export function importExchange(exchange: Exchange, open = true): { operation: Operation; result: () => ImportResult } {
  let result: ImportResult = { timeline: '', placeholders: [], matched: [] };
  const operation: Operation = (input) => {
    let project = input;
    const assets = new Map<string, string>();
    const placeholders: string[] = [];
    const matched: string[] = [];
    const use = mediaUse(exchange);
    for (const media of Object.values(exchange.media)) {
      const found = findAsset(project, media);
      if (found) {
        assets.set(media.id, found.id);
        matched.push(found.id);
        continue;
      }
      const meta = placeholder(media, use.get(media.id), exchange.main);
      project = { ...project, assets: { ...project.assets, [meta.id]: meta } };
      assets.set(media.id, meta.id);
      placeholders.push(meta.id);
    }
    const timelines = new Map<string, string>();
    const build = (sequence: ExchangeSequence, stack: string[]): string => {
      const existing = timelines.get(sequence.id);
      if (existing) return existing;
      const id = createId('timeline');
      const resolve = (clip: ExchangeClip): string | null => {
        if (clip.media) return assets.get(clip.media) ?? null;
        if (!clip.sequence) return null;
        const inner = exchange.sequences[clip.sequence];
        if (!inner || stack.includes(clip.sequence)) return null;
        const innerId = build(inner, [...stack, sequence.id]);
        project = ensureNestedAsset(innerId)(project);
        return nestedAssetId(innerId);
      };
      const tracks = buildTracks(sequence, resolve);
      const markers = sequence.markers.map((m) => ({ id: createId('marker'), time: m.time, duration: m.duration, name: m.name, note: m.note, color: m.color }));
      project = addTimeline(sequence.name, id, tracks, { width: even(sequence.width), height: even(sequence.height), fps: sequence.fps })(project);
      if (markers.length) project = { ...project, timelines: { ...project.timelines, [id]: { ...project.timelines![id], markers } } };
      timelines.set(sequence.id, id);
      return id;
    };
    const main = build(exchange.main, []);
    if (open) project = switchTimeline(main)(project);
    result = { timeline: main, placeholders, matched };
    return project;
  };
  return { operation, result: () => result };
}

const even = (n: number) => Math.max(16, Math.round(n / 2) * 2);
