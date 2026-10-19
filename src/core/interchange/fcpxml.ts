import type { Exchange, ExchangeAdjust, ExchangeClip, ExchangeMarker, ExchangeMedia, ExchangeSequence, ExchangeTrack } from './exchange';
import { isNeutral, sequenceDuration } from './exchange';
import { cutPoints, type CutClip } from './otio';
import { frameRational, parseRationalTime, rationalTime } from './timecode';
import { child, children, element, parseXml, textOf, type XmlNode } from './xml';

const TITLE_UID = '.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti';
const NEAR = 1e-3;

interface Writer {
  readonly resources: string[];
  readonly formats: Map<string, string>;
  readonly assets: Map<string, string>;
  readonly media: Map<string, string>;
  next: number;
}

const id = (w: Writer) => `r${++w.next}`;

function formatId(w: Writer, fps: number, width: number, height: number): string {
  const key = `${fps}:${width}x${height}`;
  let found = w.formats.get(key);
  if (found) return found;
  found = id(w);
  const { num, den } = frameRational(fps);
  w.formats.set(key, found);
  w.resources.push(element('format', { id: found, frameDuration: `${num}/${den}s`, width, height, name: `FFVideoFormat${height}p${Math.round(fps * 100) / 100}` }));
  return found;
}

function assetId(w: Writer, media: ExchangeMedia, fps: number): string {
  let found = w.assets.get(media.id);
  if (found) return found;
  found = id(w);
  w.assets.set(media.id, found);
  const format = media.hasVideo && media.width ? formatId(w, media.fps || fps, media.width, media.height) : null;
  const src = media.path ?? `file:///${encodeURIComponent(media.name)}`;
  w.resources.push(element('asset', {
    id: found,
    name: media.name,
    start: rationalTime(media.start, media.fps || fps),
    duration: rationalTime(media.duration, media.fps || fps),
    hasVideo: media.hasVideo ? 1 : 0,
    hasAudio: media.hasAudio ? 1 : 0,
    format,
    audioSources: media.hasAudio ? 1 : null,
    audioChannels: media.hasAudio ? media.channels : null,
    audioRate: media.hasAudio ? media.sampleRate : null,
  }, element('media-rep', { kind: 'original-media', src })));
  return found;
}

const titleEffect = (w: Writer) => {
  let found = w.assets.get('#title');
  if (!found) {
    found = id(w);
    w.assets.set('#title', found);
    w.resources.push(element('effect', { id: found, name: 'Basic Title', uid: TITLE_UID }));
  }
  return found;
};

interface SpineEntry {
  readonly kind: 'clip' | 'gap' | 'transition';
  readonly offset: number;
  readonly duration: number;
  readonly start: number;
  readonly cut?: CutClip;
  readonly connected: string[];
  readonly markers: string[];
}

const sameSource = (a: ExchangeClip, b: ExchangeClip) => (a.media ?? a.sequence) !== undefined && (a.media ?? a.sequence) === (b.media ?? b.sequence) && Math.abs(a.start - b.start) < NEAR && Math.abs(a.duration - b.duration) < NEAR && Math.abs(a.in - b.in) < NEAR;

function writeSequence(w: Writer, sequence: ExchangeSequence, exchange: Exchange, seen: Set<string>): string {
  const fps = sequence.fps;
  const t = (seconds: number) => rationalTime(seconds, fps);
  const [primary, ...others] = sequence.tracks.filter((tr) => tr.kind === 'video');
  const audio = sequence.tracks.filter((tr) => tr.kind === 'audio');
  const primaryClips = primary?.clips ?? [];
  const embedded = new Set<ExchangeClip>();
  const withSound = new Set<ExchangeClip>();
  for (const clip of primaryClips) {
    const partner = audio.flatMap((tr) => tr.clips).find((a) => !embedded.has(a) && sameSource(a, clip));
    if (partner) {
      embedded.add(partner);
      withSound.add(clip);
    }
  }
  const spine: SpineEntry[] = [];
  let cursor = 0;
  const cuts = cutPoints(primaryClips);
  cuts.forEach((cut, index) => {
    if (cut.start - cursor > NEAR) spine.push({ kind: 'gap', offset: cursor, duration: cut.start - cursor, start: 0, connected: [], markers: [] });
    if (cut.head > 0 && index > 0) spine.push({ kind: 'transition', offset: cut.start - cuts[index - 1].tail, duration: cuts[index - 1].tail + cut.head, start: 0, connected: [], markers: [] });
    spine.push({ kind: 'clip', offset: cut.start, duration: cut.end - cut.start, start: cut.clip.in + cut.head * cut.clip.speed, cut, connected: [], markers: [] });
    cursor = cut.end;
  });
  const total = sequenceDuration(sequence);
  if (total - cursor > NEAR || !spine.length) spine.push({ kind: 'gap', offset: cursor, duration: Math.max(total - cursor, 1 / fps), start: 0, connected: [], markers: [] });
  const parentAt = (time: number) => spine.find((e) => e.kind !== 'transition' && time >= e.offset - NEAR && time < e.offset + e.duration - NEAR) ?? spine.filter((e) => e.kind !== 'transition').at(-1)!;
  const local = (parent: SpineEntry, time: number) => parent.start + (time - parent.offset);

  const clipXml = (cut: CutClip, attrs: { offset: number; lane?: number; audioOnly?: boolean; sound: boolean }, inner: string[] = []): string => {
    const { clip } = cut;
    const start = clip.in + cut.head * clip.speed;
    const duration = cut.end - cut.start;
    const base = { name: clip.name, lane: attrs.lane ?? null, offset: t(attrs.offset), duration: t(duration), enabled: clip.enabled ? null : 0 };
    const adjust = adjustXml(clip.adjust, sequence.width / sequence.height, attrs.audioOnly ?? false);
    const timeMap = clip.speed !== 1 ? [element('timeMap', {}, element('timept', { time: t(start), value: t(start), interp: 'linear' }), element('timept', { time: t(start + duration), value: t(start + duration * clip.speed), interp: 'linear' }))] : [];
    if (clip.text !== undefined && !clip.media && !clip.sequence) {
      const style = `ts${w.next + 1}`;
      return element('title', { ref: titleEffect(w), ...base, start: '0s' },
        element('text', {}, element('text-style', { ref: style }, escapeText(clip.text))),
        element('text-style-def', { id: style }, element('text-style', { font: 'Helvetica', fontSize: 63, fontColor: '1 1 1 1', alignment: 'center' })),
        ...adjust,
        ...inner);
    }
    if (clip.sequence && exchange.sequences[clip.sequence] && !seen.has(clip.sequence)) {
      const ref = nestedId(w, exchange.sequences[clip.sequence], exchange, seen);
      return element('ref-clip', { ref, ...base, start: t(start), srcEnable: attrs.audioOnly ? 'audio' : attrs.sound ? null : 'video' }, ...timeMap, ...adjust, ...inner);
    }
    const media = clip.media ? exchange.media[clip.media] : undefined;
    if (!media) return element('gap', { name: clip.name, lane: attrs.lane ?? null, offset: t(attrs.offset), duration: t(duration), start: '0s' }, ...inner);
    const srcEnable = attrs.audioOnly ? (media.hasVideo ? 'audio' : null) : attrs.sound || !media.hasAudio ? null : 'video';
    return element('asset-clip', { ref: assetId(w, media, fps), ...base, start: t(start), srcEnable, tcFormat: 'NDF' }, ...timeMap, ...adjust, ...inner);
  };

  const connect = (track: ExchangeTrack, lane: number) => {
    for (const cut of cutPoints(track.clips.filter((c) => !embedded.has(c)).map((c) => ({ ...c, transition: 0 })))) {
      const parent = parentAt(cut.start);
      parent.connected.push(clipXml(cut, { offset: local(parent, cut.start), lane, audioOnly: track.kind === 'audio', sound: false }));
    }
  };
  others.forEach((track, i) => connect(track, i + 1));
  audio.forEach((track, i) => connect(track, -(i + 1)));
  for (const marker of sequence.markers) {
    const parent = parentAt(marker.time);
    parent.markers.push(markerXml(marker, local(parent, marker.time), fps));
  }
  const spineXml = spine.map((entry) => {
    if (entry.kind === 'gap') return element('gap', { name: 'Gap', offset: t(entry.offset), duration: t(entry.duration), start: t(entry.start) }, ...entry.connected, ...entry.markers);
    if (entry.kind === 'transition') return element('transition', { name: 'Cross Dissolve', offset: t(entry.offset), duration: t(entry.duration) });
    return clipXml(entry.cut!, { offset: entry.offset, sound: withSound.has(entry.cut!.clip) }, [...entry.connected, ...entry.markers]);
  });
  return element('sequence', { format: formatId(w, fps, sequence.width, sequence.height), duration: t(Math.max(total, 1 / fps)), tcStart: '0s', tcFormat: 'NDF', audioLayout: 'stereo', audioRate: sequence.sampleRate >= 96000 ? '96k' : sequence.sampleRate >= 48000 ? '48k' : '44.1k' }, element('spine', {}, ...spineXml));
}

function nestedId(w: Writer, sequence: ExchangeSequence, exchange: Exchange, seen: Set<string>): string {
  let found = w.media.get(sequence.id);
  if (found) return found;
  found = id(w);
  w.media.set(sequence.id, found);
  const body = writeSequence(w, sequence, exchange, new Set([...seen, sequence.id]));
  w.resources.push(element('media', { id: found, name: sequence.name, uid: sequence.id }, body));
  return found;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

function adjustXml(adjust: ExchangeAdjust | undefined, aspect: number, audioOnly: boolean): string[] {
  if (!adjust) return [];
  const out: string[] = [];
  const moved = adjust.x || adjust.y || adjust.scale !== 1 || adjust.rotation;
  if (!audioOnly && moved) out.push(element('adjust-transform', { position: `${round(adjust.x * aspect * 100)} ${round(adjust.y * 100)}`, scale: `${round(adjust.scale)} ${round(adjust.scale)}`, rotation: adjust.rotation ? round(adjust.rotation) : null }));
  if (!audioOnly && adjust.opacity !== 1) out.push(element('adjust-blend', { amount: round(adjust.opacity) }));
  if (adjust.volume !== 1) out.push(element('adjust-volume', { amount: `${round(adjust.volume > 0 ? 20 * Math.log10(adjust.volume) : -96)}dB` }));
  return out;
}

function readAdjust(el: XmlNode, aspect: number): ExchangeAdjust | undefined {
  const transform = child(el, 'adjust-transform');
  const blend = child(el, 'adjust-blend');
  const volume = child(el, 'adjust-volume');
  if (!transform && !blend && !volume) return undefined;
  const [px, py] = (transform?.attrs.position ?? '0 0').split(/\s+/).map(Number);
  const scale = Number((transform?.attrs.scale ?? '1 1').split(/\s+/)[0]) || 1;
  const db = volume ? parseFloat(volume.attrs.amount ?? '0') : 0;
  return {
    x: (px || 0) / 100 / aspect,
    y: (py || 0) / 100,
    scale,
    rotation: Number(transform?.attrs.rotation ?? 0) || 0,
    opacity: blend ? Number(blend.attrs.amount ?? 1) : 1,
    volume: db <= -96 ? 0 : 10 ** (db / 20),
  };
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const markerXml = (marker: ExchangeMarker, start: number, fps: number) =>
  element('marker', { start: rationalTime(start, fps), duration: rationalTime(Math.max(marker.duration, 1 / fps), fps), value: marker.name || 'Marker', note: marker.note || null });

export function writeFcpxml(exchange: Exchange): string {
  const w: Writer = { resources: [], formats: new Map(), assets: new Map(), media: new Map(), next: 0 };
  const main = exchange.main;
  const body = writeSequence(w, main, exchange, new Set([main.id]));
  const project = element('project', { name: main.name }, body);
  const library = element('library', {}, element('event', { name: 'Montage' }, project));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n${element('fcpxml', { version: '1.10' }, element('resources', {}, ...w.resources), library)}\n`;
}

interface ReadAsset {
  readonly media: ExchangeMedia;
}

interface Pending {
  readonly offset: number;
  readonly duration: number;
}

const CLIP_TYPES = new Set(['asset-clip', 'clip', 'ref-clip', 'title', 'video', 'audio', 'sync-clip', 'mc-clip', 'gap', 'transition', 'spine']);

export function readFcpxml(text: string): Exchange {
  const root = parseXml(text);
  if (root.name !== 'fcpxml') throw new Error('This is not an FCPXML file');
  const resources = child(root, 'resources');
  const formats = new Map<string, { fps: number; width: number; height: number }>();
  const assets = new Map<string, ReadAsset>();
  const mediaNodes = new Map<string, XmlNode>();
  for (const node of resources?.children ?? []) {
    if (node.name === 'format') {
      const frame = parseRationalTime(node.attrs.frameDuration ?? '1/25s');
      formats.set(node.attrs.id, { fps: frame > 0 ? Math.round(1000 / frame) / 1000 : 25, width: Number(node.attrs.width ?? 1920), height: Number(node.attrs.height ?? 1080) });
    } else if (node.name === 'media') mediaNodes.set(node.attrs.id, node);
  }
  for (const node of resources?.children ?? []) {
    if (node.name !== 'asset') continue;
    const format = formats.get(node.attrs.format ?? '');
    const rep = child(node, 'media-rep');
    const src = rep?.attrs.src ?? node.attrs.src;
    assets.set(node.attrs.id, {
      media: {
        id: node.attrs.id,
        name: node.attrs.name ?? src?.split('/').pop() ?? node.attrs.id,
        ...(src ? { path: src } : {}),
        start: parseRationalTime(node.attrs.start),
        duration: parseRationalTime(node.attrs.duration),
        fps: format?.fps ?? 0,
        width: format?.width ?? 0,
        height: format?.height ?? 0,
        hasVideo: node.attrs.hasVideo === '1',
        hasAudio: node.attrs.hasAudio === '1',
        sampleRate: Number(node.attrs.audioRate ?? 48000) || 48000,
        channels: Number(node.attrs.audioChannels ?? 2) || 2,
      },
    });
  }
  const media: Record<string, ExchangeMedia> = {};
  const sequences: Record<string, ExchangeSequence> = {};

  const readSequence = (node: XmlNode, name: string, seqId: string, stack: string[]): ExchangeSequence => {
    const format = formats.get(node.attrs.format ?? '') ?? { fps: 25, width: 1920, height: 1080 };
    const tracks = new Map<string, { kind: 'video' | 'audio'; order: number; clips: ExchangeClip[]; pending: Pending | null }>();
    const markers: ExchangeMarker[] = [];
    const trackFor = (kind: 'video' | 'audio', key: string, order: number) => {
      let track = tracks.get(key);
      if (!track) tracks.set(key, (track = { kind, order, clips: [], pending: null }));
      return track;
    };
    const push = (kind: 'video' | 'audio', key: string, order: number, clip: ExchangeClip) => {
      const track = trackFor(kind, key, order);
      const pending = track.pending;
      track.pending = null;
      if (pending && track.clips.length) {
        const prev = track.clips[track.clips.length - 1];
        const cut = clip.start;
        const overlapEnd = pending.offset + pending.duration;
        track.clips[track.clips.length - 1] = { ...prev, duration: prev.duration + Math.max(0, overlapEnd - cut) };
        const lead = Math.max(0, cut - pending.offset);
        clip = { ...clip, start: clip.start - lead, duration: clip.duration + lead, in: clip.in - lead * clip.speed, transition: pending.duration };
      }
      track.clips.push({ ...clip });
    };

    const walk = (elements: readonly XmlNode[], toAbs: (t: number) => number, laneBase: number, inSpine: boolean, audioOnly: boolean, window: readonly [number, number] | null = null) => {
      const place = (kind: 'video' | 'audio', key: string, order: number, clip: ExchangeClip) => {
        const fitted = fit(clip, window);
        if (fitted) push(kind, key, order, fitted);
      };
      for (const el of elements) {
        if (!CLIP_TYPES.has(el.name) && el.name !== 'marker' && el.name !== 'chapter-marker') continue;
        const lane = laneBase + (inSpine ? 0 : Number(el.attrs.lane ?? 0));
        const offset = parseRationalTime(el.attrs.offset);
        const abs = toAbs(offset);
        if (el.name === 'marker' || el.name === 'chapter-marker') continue;
        if (el.name === 'spine') {
          const first = el.children.find((c) => CLIP_TYPES.has(c.name));
          const base = first ? parseRationalTime(first.attrs.offset) : 0;
          walk(el.children, (t) => abs + (t - base), lane, true, audioOnly, window);
          continue;
        }
        const start = parseRationalTime(el.attrs.start);
        const duration = parseRationalTime(el.attrs.duration);
        const inner = (t: number) => abs + (t - start);
        for (const m of el.children.filter((c) => c.name === 'marker' || c.name === 'chapter-marker'))
          markers.push({ time: inner(parseRationalTime(m.attrs.start)), duration: m.name === 'marker' ? parseRationalTime(m.attrs.duration) : 0, name: m.attrs.value ?? '', note: m.attrs.note ?? '', color: m.attrs.completed !== undefined ? 'green' : 'blue' });
        if (el.name === 'transition') {
          trackFor(lane < 0 ? 'audio' : 'video', laneKey(lane, false), laneOrder(lane)).pending = { offset: abs, duration };
          if (lane >= 0) trackFor('audio', laneKey(lane, true), laneOrder(lane, true)).pending = { offset: abs, duration };
          continue;
        }
        const enabled = el.attrs.enabled !== '0';
        const adjusted = readAdjust(el, format.width / format.height);
        const extra = adjusted && !isNeutral(adjusted) ? { adjust: adjusted } : {};
        const speed = speedOf(el);
        const sourceIn = sourceAt(el, start);
        const srcEnable = el.attrs.srcEnable ?? 'all';
        const onlyAudio = audioOnly || lane < 0 || el.name === 'audio';
        if (el.name === 'title') {
          const textNode = child(el, 'text');
          place('video', laneKey(lane, false), laneOrder(lane), { name: el.attrs.name ?? 'Title', text: textNode ? textOf(textNode).trim() : (el.attrs.name ?? ''), start: abs, duration, in: 0, speed: 1, transition: 0, enabled, ...extra });
        } else if (el.name === 'asset-clip' || el.name === 'video' || el.name === 'audio') {
          const asset = assets.get(el.attrs.ref ?? '');
          if (asset) {
            media[asset.media.id] ??= asset.media;
            const clip: ExchangeClip = { name: el.attrs.name ?? asset.media.name, media: asset.media.id, start: abs, duration, in: sourceIn, speed, transition: 0, enabled, ...extra };
            if (asset.media.hasVideo && !onlyAudio && srcEnable !== 'audio') place('video', laneKey(lane, false), laneOrder(lane), clip);
            if (asset.media.hasAudio && srcEnable !== 'video' && el.name !== 'video') place('audio', laneKey(lane, !onlyAudio), laneOrder(lane, !onlyAudio), clip);
          }
        } else if (el.name === 'ref-clip') {
          const mediaNode = mediaNodes.get(el.attrs.ref ?? '');
          const seqNode = mediaNode && child(mediaNode, 'sequence');
          if (mediaNode && seqNode && !stack.includes(mediaNode.attrs.id)) {
            const innerId = mediaNode.attrs.id;
            sequences[innerId] ??= readSequence(seqNode, mediaNode.attrs.name ?? el.attrs.name ?? 'Compound clip', innerId, [...stack, innerId]);
            const clip: ExchangeClip = { name: el.attrs.name ?? sequences[innerId].name, sequence: innerId, start: abs, duration, in: sourceIn, speed, transition: 0, enabled, ...extra };
            if (!onlyAudio && srcEnable !== 'audio') place('video', laneKey(lane, false), laneOrder(lane), clip);
            if (srcEnable !== 'video') place('audio', laneKey(lane, !onlyAudio), laneOrder(lane, !onlyAudio), clip);
          }
        } else if (el.name === 'clip' || el.name === 'sync-clip') {
          const nested = el.children.find((c) => c.name === 'spine' && c.attrs.lane === undefined);
          const contents = nested ? nested.children : el.children.filter((c) => CLIP_TYPES.has(c.name) && c.attrs.lane === undefined);
          walk(contents, inner, lane, true, onlyAudio, [abs, abs + duration]);
        } else if (el.name === 'mc-clip') {
          const mediaNode = mediaNodes.get(el.attrs.ref ?? '');
          const multicam = mediaNode && child(mediaNode, 'multicam');
          const sources = children(el, 'mc-source');
          const videoAngle = sources.find((s) => s.attrs.srcEnable === 'video' || s.attrs.srcEnable === 'all')?.attrs.angleID;
          const angle = multicam && (children(multicam, 'mc-angle').find((a) => a.attrs.angleID === videoAngle) ?? children(multicam, 'mc-angle')[0]);
          if (angle) walk(angle.children, inner, lane, true, onlyAudio, [abs, abs + duration]);
        }
        walk(el.children.filter((c) => CLIP_TYPES.has(c.name) && c.attrs.lane !== undefined), inner, 0, false, false, window);
      }
    };

    const spine = child(node, 'spine');
    if (spine) walk(spine.children, (t) => t, 0, true, false);
    const ordered = [...tracks.entries()].filter(([, t]) => t.clips.length).sort((a, b) => a[1].order - b[1].order);
    const list: ExchangeTrack[] = [];
    let v = 0;
    let a = 0;
    for (const [, track] of ordered) {
      const sorted = track.clips.slice().sort((x, y) => x.start - y.start);
      list.push({ kind: track.kind, name: track.kind === 'video' ? `V${++v}` : `A${++a}`, clips: sorted });
    }
    if (!list.some((t) => t.kind === 'video')) list.unshift({ kind: 'video', name: 'V1', clips: [] });
    return { id: seqId, name, fps: format.fps, width: format.width, height: format.height, sampleRate: audioRate(node.attrs.audioRate), tracks: list, markers: markers.sort((x, y) => x.time - y.time) };
  };

  const project = findFirst(root, 'project');
  const sequenceNode = project ? child(project, 'sequence') : findFirst(root, 'sequence');
  if (!sequenceNode) throw new Error('This FCPXML file has no sequence');
  const main = readSequence(sequenceNode, project?.attrs.name ?? 'Imported timeline', 'main', []);
  return { main, sequences, media };
}

function fit(clip: ExchangeClip, window: readonly [number, number] | null): ExchangeClip | null {
  if (!window) return clip;
  const start = Math.max(clip.start, window[0]);
  const end = Math.min(clip.start + clip.duration, window[1]);
  if (end - start < NEAR) return null;
  return { ...clip, start, duration: end - start, in: clip.in + (start - clip.start) * clip.speed };
}

const laneKey = (lane: number, embedded: boolean) => (embedded ? `audio:embedded:${lane}` : lane < 0 ? `audio:${lane}` : `video:${lane}`);

const laneOrder = (lane: number, embedded = false) => (embedded ? 1000 + lane : lane < 0 ? 2000 - lane : lane);

const audioRate = (rate: string | undefined) => (rate === '96k' ? 96000 : rate === '44.1k' ? 44100 : rate === '32k' ? 32000 : 48000);

function findFirst(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name === name) return c;
    const deeper = findFirst(c, name);
    if (deeper) return deeper;
  }
  return null;
}

function timePoints(el: XmlNode): { time: number; value: number }[] {
  const map = child(el, 'timeMap');
  return map ? children(map, 'timept').map((p) => ({ time: parseRationalTime(p.attrs.time), value: parseRationalTime(p.attrs.value) })) : [];
}

function speedOf(el: XmlNode): number {
  const points = timePoints(el);
  if (points.length < 2) return 1;
  const [a, b] = [points[0], points[points.length - 1]];
  const speed = (b.value - a.value) / (b.time - a.time);
  return speed > 0 && Number.isFinite(speed) ? speed : 1;
}

function sourceAt(el: XmlNode, start: number): number {
  const points = timePoints(el);
  if (points.length < 2) return start;
  const [a, b] = [points[0], points[points.length - 1]];
  return a.value + ((start - a.time) * (b.value - a.value)) / (b.time - a.time);
}
