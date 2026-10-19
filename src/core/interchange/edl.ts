import type { Exchange, ExchangeClip, ExchangeMedia, ExchangeTrack } from './exchange';
import { formatTimecode, parseTimecode } from './timecode';

const RECORD_START = 3600;
const AUDIO_CHANNELS = ['A', 'A2', 'A3', 'A4'];

export interface EdlOptions {
  readonly videoTrack?: number;
}

const pad = (text: string, width: number) => text.padEnd(width, ' ');

export function writeEdl(exchange: Exchange, options: EdlOptions = {}): string {
  const sequence = exchange.main;
  const fps = sequence.fps;
  const tc = (seconds: number) => formatTimecode(seconds, fps);
  const video = sequence.tracks.filter((t) => t.kind === 'video');
  const audio = sequence.tracks.filter((t) => t.kind === 'audio').slice(0, AUDIO_CHANNELS.length);
  const lines = [`TITLE: ${sequence.name.replace(/[\r\n]+/g, ' ').slice(0, 70)}`, 'FCM: NON-DROP FRAME', ''];
  let number = 0;
  const event = (channel: string, transition: string, clip: ExchangeClip, srcIn: number, srcOut: number, recIn: number, recOut: number) =>
    `${String(number).padStart(3, '0')}  ${pad('AX', 8)} ${pad(channel, 5)} ${pad(transition, 8)} ${tc(srcIn)} ${tc(srcOut)} ${tc(recIn)} ${tc(recOut)}`;
  const nameOf = (clip: ExchangeClip) => (clip.media ? exchange.media[clip.media]?.name : undefined) ?? clip.name;
  const emit = (track: ExchangeTrack, channel: string) => {
    const clips = track.clips.filter((c) => c.text === undefined || c.media || c.sequence).slice().sort((a, b) => a.start - b.start);
    clips.forEach((clip, i) => {
      const next = clips[i + 1];
      const visibleEnd = next && next.transition > 0 ? next.start : clip.start + clip.duration;
      const srcIn = clip.in;
      const srcOut = clip.in + (visibleEnd - clip.start) * clip.speed;
      number++;
      const prev = clips[i - 1];
      if (clip.transition > 0 && prev) {
        const prevSrc = prev.in + (clip.start - prev.start) * prev.speed;
        const frames = Math.round(clip.transition * fps);
        lines.push(event(channel, 'C', prev, prevSrc, prevSrc, RECORD_START + clip.start, RECORD_START + clip.start));
        lines.push(`${String(number).padStart(3, '0')}  ${pad('AX', 8)} ${pad(channel, 5)} ${pad(`D    ${String(frames).padStart(3, '0')}`, 8)} ${tc(srcIn)} ${tc(srcOut)} ${tc(RECORD_START + clip.start)} ${tc(RECORD_START + visibleEnd)}`);
        lines.push(`* FROM CLIP NAME: ${nameOf(prev)}`);
        lines.push(`* TO CLIP NAME: ${nameOf(clip)}`);
      } else {
        lines.push(event(channel, 'C', clip, srcIn, srcOut, RECORD_START + clip.start, RECORD_START + visibleEnd));
        lines.push(`* FROM CLIP NAME: ${nameOf(clip)}`);
      }
      const media = clip.media ? exchange.media[clip.media] : undefined;
      if (media?.path) lines.push(`* SOURCE FILE: ${media.path}`);
      if (clip.speed !== 1) lines.push(`M2   ${pad('AX', 8)} ${(clip.speed * fps).toFixed(1).padStart(6, '0')}${' '.repeat(16)}${tc(srcIn)}`);
      if (!clip.enabled) lines.push('* CLIP DISABLED');
      lines.push('');
    });
  };
  const picked = video[options.videoTrack ?? 0];
  if (picked) emit(picked, 'V');
  audio.forEach((track, i) => emit(track, AUDIO_CHANNELS[i]));
  return lines.join('\n') + '\n';
}

export interface EdlReadOptions {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

const EVENT = /^(\d{1,6})\s+(\S+)\s+(\S+)\s+(C|D|W\d{3}|KB|K\s*O?|K)\s+(\d{1,4}\s+)?(\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3})\s+(\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3})\s+(\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3})\s+(\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3})\s*$/i;
const SPEED = /^M2\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3})/i;

interface RawEvent {
  readonly number: string;
  readonly reel: string;
  readonly channel: string;
  readonly transition: string;
  readonly duration: number;
  readonly srcIn: number;
  readonly srcOut: number;
  readonly recIn: number;
  readonly recOut: number;
  name?: string;
  toName?: string;
  path?: string;
  speed?: number;
  disabled?: boolean;
}

export function readEdl(text: string, options: EdlReadOptions): Exchange {
  const { fps } = options;
  const events: RawEvent[] = [];
  let title = options.name ?? 'Imported EDL';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const titleMatch = /^TITLE:\s*(.*)$/i.exec(line);
    if (titleMatch) {
      title = titleMatch[1].trim() || title;
      continue;
    }
    const match = EVENT.exec(line);
    if (match) {
      const [, number, reel, channel, transition, duration, a, b, c, d] = match;
      events.push({ number, reel, channel: channel.toUpperCase(), transition: transition.toUpperCase().replace(/\s+/g, ''), duration: Number(duration ?? 0), srcIn: parseTimecode(a, fps), srcOut: parseTimecode(b, fps), recIn: parseTimecode(c, fps), recOut: parseTimecode(d, fps) });
      continue;
    }
    const last = events[events.length - 1];
    if (!last) continue;
    const speed = SPEED.exec(line);
    if (speed) {
      for (const e of events.filter((x) => x.number === last.number)) e.speed = Math.abs(Number(speed[2])) / fps || 1;
      continue;
    }
    const comment = /^\*\s*(FROM CLIP NAME|TO CLIP NAME|SOURCE FILE|FROM CLIP|TO CLIP|CLIP DISABLED)\s*:?\s*(.*)$/i.exec(line);
    if (!comment) continue;
    const key = comment[1].toUpperCase();
    const value = comment[2].trim();
    const group = events.filter((x) => x.number === last.number);
    if (key === 'FROM CLIP NAME') group[0].name = value;
    else if (key === 'TO CLIP NAME') group[group.length - 1].toName = value;
    else if (key === 'FROM CLIP') group[0].path ??= value;
    else if (key === 'SOURCE FILE' || key === 'TO CLIP') group[group.length - 1].path ??= value;
    else for (const e of group) e.disabled = true;
  }
  if (!events.length) throw new Error('No events found in this EDL');
  const offset = Math.floor(Math.min(...events.map((e) => e.recIn)) / 3600) * 3600;
  const media: Record<string, ExchangeMedia> = {};
  const tracks = new Map<string, ExchangeClip[]>();
  const mediaFor = (event: RawEvent, name: string) => {
    const key = name || event.reel;
    media[key] ??= { id: key, name: key, ...(event.path ? { path: event.path } : {}), start: 0, duration: 0, fps, width: options.width, height: options.height, hasVideo: false, hasAudio: false, sampleRate: 48000, channels: 2 };
    return media[key];
  };
  const channels = (channel: string): string[] => {
    const out: string[] = [];
    if (channel.includes('V') || channel === 'B') out.push('V');
    if (channel === 'B' || /^A(\/|$)/.test(channel) || channel.startsWith('AA') || /^A1/.test(channel)) out.push('A1');
    const numbered = /A(\d)/g;
    for (let m = numbered.exec(channel); m; m = numbered.exec(channel)) if (m[1] !== '1') out.push(`A${m[1]}`);
    if (channel.startsWith('AA')) out.push('A2');
    return [...new Set(out)];
  };
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const pairedFrom = events[i + 1]?.number === event.number ? event : null;
    const incoming = pairedFrom ? events[++i] : event;
    if (/^(BL|BLACK)$/i.test(incoming.reel)) continue;
    const name = (pairedFrom ? incoming.toName ?? incoming.name : incoming.name) ?? incoming.reel;
    const transition = incoming.transition.startsWith('D') || incoming.transition.startsWith('W') ? incoming.duration / fps : 0;
    const speed = incoming.speed ?? 1;
    for (const ch of channels(incoming.channel)) {
      const list = tracks.get(ch) ?? [];
      tracks.set(ch, list);
      const m = mediaFor(incoming, name);
      if (ch === 'V') media[m.id] = { ...media[m.id], hasVideo: true };
      else media[m.id] = { ...media[m.id], hasAudio: true };
      const prev = list[list.length - 1];
      if (transition > 0 && prev) list[list.length - 1] = { ...prev, duration: prev.duration + transition };
      list.push({
        name,
        media: m.id,
        start: incoming.recIn - offset,
        duration: incoming.recOut - incoming.recIn,
        in: incoming.srcIn,
        speed,
        transition: prev ? transition : 0,
        enabled: !incoming.disabled,
      });
    }
  }
  const ordered = [...tracks.entries()].sort(([a], [b]) => (a === 'V' ? -1 : b === 'V' ? 1 : a.localeCompare(b)));
  const list: ExchangeTrack[] = ordered.map(([ch, clips]) => ({ kind: ch === 'V' ? 'video' : 'audio', name: ch === 'V' ? 'V1' : ch, clips }));
  if (!list.some((t) => t.kind === 'video')) list.unshift({ kind: 'video', name: 'V1', clips: [] });
  return {
    main: { id: 'main', name: title, fps, width: options.width, height: options.height, sampleRate: 48000, tracks: list, markers: [] },
    sequences: {},
    media,
  };
}
