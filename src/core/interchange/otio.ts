import type { Exchange, ExchangeAdjust, ExchangeClip, ExchangeMarker, ExchangeMedia, ExchangeSequence, ExchangeTrack } from './exchange';

type Json = Record<string, unknown>;

const MARKER_COLORS: Record<string, string> = { red: 'RED', orange: 'ORANGE', yellow: 'YELLOW', green: 'GREEN', cyan: 'CYAN', blue: 'BLUE', purple: 'PURPLE', pink: 'PINK', white: 'WHITE', black: 'BLACK' };

const rt = (seconds: number, rate: number): Json => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(seconds * rate * 1e6) / 1e6 });
const range = (start: number, duration: number, rate: number): Json => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start, rate), duration: rt(duration, rate) });

const fileUrl = (media: ExchangeMedia) => media.path ?? `file:///${encodeURIComponent(media.name)}`;

function markerJson(marker: ExchangeMarker, rate: number, offset = 0): Json {
  return {
    OTIO_SCHEMA: 'Marker.2',
    name: marker.name,
    color: MARKER_COLORS[marker.color] ?? 'RED',
    comment: marker.note,
    marked_range: range(marker.time - offset, marker.duration, rate),
    metadata: { montage: { color: marker.color } },
  };
}

function writeSequence(sequence: ExchangeSequence, exchange: Exchange, seen: Set<string>): Json {
  const rate = sequence.fps;
  const tracks = sequence.tracks.map((track) => writeTrack(track, rate, exchange, seen));
  return {
    OTIO_SCHEMA: 'Stack.1',
    name: sequence.name,
    source_range: null,
    effects: [],
    markers: sequence.markers.map((m) => markerJson(m, rate)),
    enabled: true,
    metadata: { montage: { id: sequence.id, width: sequence.width, height: sequence.height, fps: sequence.fps, sampleRate: sequence.sampleRate } },
    children: tracks,
  };
}

function writeTrack(track: ExchangeTrack, rate: number, exchange: Exchange, seen: Set<string>): Json {
  const children: Json[] = [];
  let cursor = 0;
  const clips = cutPoints(track.clips);
  clips.forEach(({ clip, start, end, head }, index) => {
    if (start - cursor > 1e-6) children.push({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: range(0, start - cursor, rate), effects: [], markers: [], enabled: true, metadata: {} });
    if (head > 0 && index > 0) {
      const tail = clips[index - 1].tail;
      children.push({ OTIO_SCHEMA: 'Transition.1', name: 'Cross Dissolve', transition_type: 'SMPTE_Dissolve', in_offset: rt(tail, rate), out_offset: rt(head, rate), metadata: {} });
    }
    children.push(writeItem(clip, start - clip.start, end - start, rate, exchange, seen));
    cursor = end;
  });
  return { OTIO_SCHEMA: 'Track.1', name: track.name, kind: track.kind === 'video' ? 'Video' : 'Audio', source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children };
}

export interface CutClip {
  readonly clip: ExchangeClip;
  readonly start: number;
  readonly end: number;
  readonly head: number;
  readonly tail: number;
}

export function cutPoints(clips: readonly ExchangeClip[]): CutClip[] {
  const ordered = clips.slice().sort((a, b) => a.start - b.start);
  return ordered.map((clip, i) => {
    const head = clip.transition > 0 && i > 0 ? clip.transition / 2 : 0;
    const next = ordered[i + 1];
    const tail = next && next.transition > 0 ? next.transition / 2 : 0;
    return { clip, start: clip.start + head, end: clip.start + clip.duration - tail, head, tail };
  });
}

function writeItem(clip: ExchangeClip, trimHead: number, duration: number, rate: number, exchange: Exchange, seen: Set<string>): Json {
  const sourceStart = clip.in + trimHead * clip.speed;
  const effects = clip.speed !== 1 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: 'speed', effect_name: 'LinearTimeWarp', time_scalar: clip.speed, metadata: {} }] : [];
  if (clip.sequence && exchange.sequences[clip.sequence] && !seen.has(clip.sequence)) {
    const inner = exchange.sequences[clip.sequence];
    const stack = writeSequence(inner, exchange, new Set([...seen, clip.sequence]));
    return { ...stack, name: clip.name, source_range: range(sourceStart, duration, inner.fps), effects, enabled: clip.enabled, metadata: { montage: { ...(stack.metadata as Json).montage as Json, ...(clip.adjust ? { adjust: clip.adjust } : {}) } } };
  }
  const media = clip.media ? exchange.media[clip.media] : undefined;
  const reference = clip.text !== undefined && !clip.media
    ? { OTIO_SCHEMA: 'GeneratorReference.1', name: 'Text', generator_kind: 'Text', parameters: { text: clip.text }, available_range: null, metadata: {} }
    : media
      ? {
          OTIO_SCHEMA: 'ExternalReference.1',
          name: media.name,
          target_url: fileUrl(media),
          available_range: range(media.start, media.duration, media.fps),
          metadata: { montage: { width: media.width, height: media.height, hasVideo: media.hasVideo, hasAudio: media.hasAudio, sampleRate: media.sampleRate, channels: media.channels } },
        }
      : { OTIO_SCHEMA: 'MissingReference.1', name: clip.name, available_range: null, metadata: {} };
  return {
    OTIO_SCHEMA: 'Clip.2',
    name: clip.name,
    source_range: range(sourceStart, duration, rate),
    effects,
    markers: [],
    enabled: clip.enabled,
    metadata: clip.adjust ? { montage: { adjust: clip.adjust } } : {},
    media_references: { DEFAULT_MEDIA: reference },
    active_media_reference_key: 'DEFAULT_MEDIA',
  };
}

export function writeOtio(exchange: Exchange): string {
  const main = exchange.main;
  const stack = writeSequence(main, exchange, new Set([main.id]));
  const timeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: main.name,
    global_start_time: rt(0, main.fps),
    metadata: { montage: { fps: main.fps, width: main.width, height: main.height, sampleRate: main.sampleRate } },
    tracks: { ...stack, name: 'tracks' },
  };
  return JSON.stringify(timeline, null, 2);
}

const schema = (node: Json) => String(node.OTIO_SCHEMA ?? '').split('.')[0];

const seconds = (value: unknown): number => {
  const t = value as { value?: number; rate?: number } | null;
  if (!t || typeof t.value !== 'number' || !t.rate) return 0;
  return t.value / t.rate;
};

const rateOf = (value: unknown, fallback: number): number => (value as { rate?: number } | null)?.rate || fallback;

export function readOtio(text: string): Exchange {
  const root = JSON.parse(text) as Json;
  if (schema(root) !== 'Timeline') throw new Error('This OTIO file has no Timeline');
  const media: Record<string, ExchangeMedia> = {};
  const sequences: Record<string, ExchangeSequence> = {};
  const meta = ((root.metadata as Json | undefined)?.montage ?? {}) as Partial<ExchangeSequence>;
  const stack = root.tracks as Json;
  const firstClipRate = findRate(stack);
  const fps = meta.fps ?? rateOf(root.global_start_time, firstClipRate ?? 25);
  let counter = 0;

  const readStack = (node: Json, name: string, format: Partial<ExchangeSequence>): ExchangeSequence => {
    const stackMeta = ((node.metadata as Json | undefined)?.montage ?? {}) as Partial<ExchangeSequence>;
    const rate = stackMeta.fps ?? format.fps ?? fps;
    const tracks = ((node.children as Json[]) ?? []).filter((c) => schema(c) === 'Track').map((t) => readTrack(t, rate));
    const markers = ((node.markers as Json[]) ?? []).map((m) => readMarker(m, 0));
    return {
      id: String(stackMeta.id ?? `seq${counter++}`),
      name,
      fps: rate,
      width: stackMeta.width ?? format.width ?? 1920,
      height: stackMeta.height ?? format.height ?? 1080,
      sampleRate: stackMeta.sampleRate ?? format.sampleRate ?? 48000,
      tracks,
      markers,
    };
  };

  const readMarker = (node: Json, offset: number): ExchangeMarker => {
    const marked = node.marked_range as Json | undefined;
    const own = ((node.metadata as Json | undefined)?.montage as { color?: string } | undefined)?.color;
    return {
      time: seconds(marked?.start_time) + offset,
      duration: seconds(marked?.duration),
      name: String(node.name ?? ''),
      note: String(node.comment ?? ''),
      color: own ?? String(node.color ?? 'RED').toLowerCase(),
    };
  };

  const readTrack = (node: Json, rate: number): ExchangeTrack => {
    const kind = String(node.kind ?? 'Video').toLowerCase() === 'audio' ? 'audio' : 'video';
    const clips: ExchangeClip[] = [];
    let cursor = 0;
    let pending: { in: number; out: number } | null = null;
    for (const child of (node.children as Json[]) ?? []) {
      const type = schema(child);
      if (type === 'Transition') {
        pending = { in: seconds(child.in_offset), out: seconds(child.out_offset) };
        continue;
      }
      const sourceRange = child.source_range as Json | null;
      const duration = seconds(sourceRange?.duration) || availableDuration(child);
      if (type === 'Gap') {
        cursor += duration;
        pending = null;
        continue;
      }
      const speed = timeScalar(child);
      let start = cursor;
      let length = duration;
      let inPoint = seconds(sourceRange?.start_time) || availableStart(child);
      let transition = 0;
      if (pending && clips.length) {
        const prev = clips[clips.length - 1];
        clips[clips.length - 1] = { ...prev, duration: prev.duration + pending.out };
        start -= pending.in;
        length += pending.in;
        inPoint -= pending.in * speed;
        transition = pending.in + pending.out;
      }
      pending = null;
      const enabled = child.enabled !== false;
      const name = String(child.name ?? '');
      const adjust = ((child.metadata as Json | undefined)?.montage as { adjust?: ExchangeAdjust } | undefined)?.adjust;
      const extra = adjust ? { adjust } : {};
      if (type === 'Stack') {
        const inner = readStack(child, name || `Nested ${counter + 1}`, { fps: rate });
        sequences[inner.id] = inner;
        clips.push({ name: inner.name, sequence: inner.id, start, duration: length, in: inPoint, speed, transition, enabled, ...extra });
      } else if (type === 'Clip') {
        const ref = activeReference(child);
        const refType = ref ? schema(ref) : 'MissingReference';
        if (refType === 'GeneratorReference') {
          const params = (ref!.parameters ?? {}) as { text?: string };
          clips.push({ name, text: String(params.text ?? name), start, duration: length, in: 0, speed: 1, transition, enabled, ...extra });
        } else {
          const id = mediaKey(ref, name);
          if (!media[id]) media[id] = readMedia(ref, name, rate);
          clips.push({ name, media: id, start, duration: length, in: inPoint, speed, transition, enabled, ...extra });
        }
      }
      cursor += duration;
    }
    return { kind, name: String(node.name ?? ''), clips };
  };

  const main = readStack(stack, String(root.name ?? 'Imported timeline'), meta);
  return { main, sequences, media };
}

function findRate(node: Json): number | null {
  for (const track of (node.children as Json[]) ?? [])
    for (const child of (track.children as Json[]) ?? []) {
      const r = (child.source_range as Json | null)?.duration;
      if (r) return rateOf(r, 25);
    }
  return null;
}

function activeReference(clip: Json): Json | null {
  const refs = clip.media_references as Record<string, Json> | undefined;
  if (refs) return refs[String(clip.active_media_reference_key ?? 'DEFAULT_MEDIA')] ?? Object.values(refs)[0] ?? null;
  return (clip.media_reference as Json | undefined) ?? null;
}

function timeScalar(item: Json): number {
  for (const effect of (item.effects as Json[]) ?? []) {
    const type = schema(effect);
    if (type === 'LinearTimeWarp' && typeof effect.time_scalar === 'number' && effect.time_scalar > 0) return effect.time_scalar;
    if (type === 'FreezeFrame') return 1;
  }
  return 1;
}

const availableDuration = (item: Json) => seconds((activeReference(item)?.available_range as Json | undefined)?.duration);
const availableStart = (item: Json) => seconds((activeReference(item)?.available_range as Json | undefined)?.start_time);

function mediaKey(ref: Json | null, name: string): string {
  if (!ref) return `missing:${name}`;
  return String(ref.target_url ?? ref.name ?? name);
}

function readMedia(ref: Json | null, name: string, rate: number): ExchangeMedia {
  const available = ref?.available_range as Json | undefined;
  const extra = (((ref?.metadata as Json | undefined)?.montage ?? {}) as Partial<ExchangeMedia>);
  const url = ref?.target_url ? String(ref.target_url) : undefined;
  return {
    id: mediaKey(ref, name),
    name: String(ref?.name || name),
    ...(url ? { path: url } : {}),
    start: seconds(available?.start_time),
    duration: seconds(available?.duration),
    fps: rateOf(available?.duration, rate),
    width: extra.width ?? 0,
    height: extra.height ?? 0,
    hasVideo: extra.hasVideo ?? false,
    hasAudio: extra.hasAudio ?? false,
    sampleRate: extra.sampleRate ?? 48000,
    channels: extra.channels ?? 2,
  };
}
