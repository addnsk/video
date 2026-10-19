import { createId } from './ids';
import { IDENTITY_TRANSFORM, type Project, type SubtitleCue, type SubtitleStyle, type SubtitleTrack, type TextItem } from './model';
import type { Operation } from './operations';

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: 'IBM Plex Sans',
  weight: 600,
  size: 0.055,
  color: '#ffffff',
  outline: '#000000',
  outlineWidth: 0.12,
  background: null,
  position: 0.1,
  maxWidth: 0.8,
};

export const MIN_CUE = 0.04;

const subtitlesOf = (project: Project): readonly SubtitleTrack[] => project.subtitles ?? [];

const withSubtitles = (project: Project, subtitles: readonly SubtitleTrack[]): Project => {
  if (subtitles.length) return { ...project, subtitles };
  const { subtitles: _gone, ...rest } = project;
  return rest;
};

const requireTrack = (project: Project, id: string): SubtitleTrack => {
  const track = subtitlesOf(project).find((t) => t.id === id);
  if (!track) throw new Error(`Unknown subtitle track ${id}`);
  return track;
};

const mapTrack = (project: Project, id: string, fn: (track: SubtitleTrack) => SubtitleTrack): Project => {
  requireTrack(project, id);
  return withSubtitles(project, subtitlesOf(project).map((t) => (t.id === id ? fn(t) : t)));
};

const cleanCue = (cue: SubtitleCue): SubtitleCue => {
  const start = Math.max(0, cue.start);
  if (!Number.isFinite(start) || !Number.isFinite(cue.end)) throw new Error('Subtitle times must be numbers');
  if (cue.end - start < MIN_CUE - 1e-9) throw new Error('A subtitle must last at least 0.04 s');
  return { id: cue.id, start, end: cue.end, text: cue.text.replace(/\r\n?/g, '\n').trim() };
};

const sorted = (cues: readonly SubtitleCue[]) => cues.slice().sort((a, b) => a.start - b.start || a.end - b.end);

export interface SubtitleTrackOptions {
  readonly name?: string;
  readonly language?: string;
  readonly burnIn?: boolean;
  readonly visible?: boolean;
  readonly style?: Partial<SubtitleStyle>;
  readonly cues?: readonly Omit<SubtitleCue, 'id'>[];
}

export const addSubtitleTrack = (options: SubtitleTrackOptions = {}, id = createId('subtitles')): Operation => (project) => {
  const count = subtitlesOf(project).length;
  const track: SubtitleTrack = {
    id,
    name: options.name?.trim() || `Subtitles ${count + 1}`,
    language: options.language ?? 'und',
    burnIn: options.burnIn ?? false,
    visible: options.visible ?? true,
    style: checkStyle({ ...DEFAULT_SUBTITLE_STYLE, ...options.style }),
    cues: sorted((options.cues ?? []).map((c) => cleanCue({ ...c, id: createId('cue') }))),
  };
  return withSubtitles(project, [...subtitlesOf(project), track]);
};

function checkStyle(style: SubtitleStyle): SubtitleStyle {
  if (!(style.size > 0 && style.size <= 0.5)) throw new Error('Subtitle size must be between 0 and 0.5 of the frame height');
  if (!(style.position >= 0 && style.position <= 1)) throw new Error('Subtitle position must be between 0 (bottom) and 1 (top)');
  if (!(style.maxWidth > 0.05 && style.maxWidth <= 1)) throw new Error('Subtitle width must be between 0.05 and 1 of the frame width');
  if (!(style.outlineWidth >= 0 && style.outlineWidth <= 0.5)) throw new Error('Outline width must be between 0 and 0.5 of the text size');
  return style;
}

export type SubtitleTrackPatch = Partial<Pick<SubtitleTrack, 'name' | 'language' | 'burnIn' | 'visible'>> & { readonly style?: Partial<SubtitleStyle> };

export const updateSubtitleTrack = (id: string, patch: SubtitleTrackPatch): Operation => (project) =>
  mapTrack(project, id, (track) => ({
    ...track,
    ...(patch.name !== undefined ? { name: patch.name.trim() || track.name } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.burnIn !== undefined ? { burnIn: patch.burnIn } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(patch.style ? { style: checkStyle({ ...track.style, ...patch.style }) } : {}),
  }));

export const removeSubtitleTrack = (id: string): Operation => (project) => {
  requireTrack(project, id);
  return withSubtitles(project, subtitlesOf(project).filter((t) => t.id !== id));
};

export const addCue = (trackId: string, cue: Omit<SubtitleCue, 'id'>, id = createId('cue')): Operation => (project) =>
  mapTrack(project, trackId, (track) => ({ ...track, cues: sorted([...track.cues, cleanCue({ ...cue, id })]) }));

export const updateCue = (trackId: string, cueId: string, patch: Partial<Omit<SubtitleCue, 'id'>>): Operation => (project) =>
  mapTrack(project, trackId, (track) => {
    if (!track.cues.some((c) => c.id === cueId)) throw new Error(`Unknown subtitle ${cueId}`);
    return { ...track, cues: sorted(track.cues.map((c) => (c.id === cueId ? cleanCue({ ...c, ...patch }) : c))) };
  });

export const removeCue = (trackId: string, cueId: string): Operation => (project) =>
  mapTrack(project, trackId, (track) => ({ ...track, cues: track.cues.filter((c) => c.id !== cueId) }));

export const setCues = (trackId: string, cues: readonly Omit<SubtitleCue, 'id'>[]): Operation => (project) =>
  mapTrack(project, trackId, (track) => ({ ...track, cues: sorted(cues.map((c) => cleanCue({ ...c, id: createId('cue') }))) }));

export const shiftCues = (trackId: string, offset: number): Operation => (project) =>
  mapTrack(project, trackId, (track) => ({ ...track, cues: track.cues.filter((c) => c.end + offset > MIN_CUE).map((c) => ({ ...c, start: Math.max(0, c.start + offset), end: c.end + offset })) }));

export const cuesAt = (track: SubtitleTrack, time: number): SubtitleCue[] => track.cues.filter((c) => time >= c.start && time < c.end);

const itemCache = new WeakMap<SubtitleTrack, Map<string, TextItem>>();

export function subtitleItem(track: SubtitleTrack, cues: readonly SubtitleCue[]): TextItem {
  let byKey = itemCache.get(track);
  if (!byKey) itemCache.set(track, (byKey = new Map()));
  const key = cues.map((c) => c.id).join('+');
  const hit = byKey.get(key);
  if (hit) return hit;
  const { style } = track;
  const start = Math.max(...cues.map((c) => c.start));
  const end = Math.min(...cues.map((c) => c.end));
  const item: TextItem = {
    id: `subtitle:${track.id}:${key}`,
    kind: 'text',
    start,
    duration: end - start,
    effects: [],
    transitionIn: null,
    volume: 1,
    opacity: 1,
    transform: IDENTITY_TRANSFORM,
    animations: {},
    presets: {},
    text: {
      content: cues.map((c) => c.text).join('\n'),
      font: style.font,
      weight: style.weight,
      size: style.size,
      color: style.color,
      align: 'center',
      background: style.background,
      outline: style.outline,
      outlineWidth: style.outlineWidth,
      maxWidth: style.maxWidth,
      bottom: style.position,
    },
  };
  byKey.set(key, item);
  return item;
}

export interface ParsedCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

const parseTime = (text: string): number => {
  const m = TIME.exec(text);
  if (!m) throw new Error(`Bad subtitle time "${text}"`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
};

const stripTags = (text: string) => text.replace(/\{\\[^}]*\}/g, '').replace(/<\/?(?:i|b|u|font|c|v|lang|ruby|rt)(?:[\s.][^>]*)?>/gi, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

export function parseSubtitles(source: string): ParsedCue[] {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: ParsedCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim() !== '');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split('-->');
    const start = parseTime(a);
    const end = parseTime(b);
    const body = stripTags(lines.slice(timing + 1).join('\n')).trim();
    if (!body || end - start < MIN_CUE - 1e-9) continue;
    cues.push({ start, end, text: body });
  }
  if (!cues.length && text.trim()) throw new Error('No subtitles found in this file');
  return cues.sort((x, y) => x.start - y.start);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatTime(seconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

export function writeSrt(cues: readonly ParsedCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${formatTime(c.start, ',')} --> ${formatTime(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function writeVtt(cues: readonly ParsedCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${formatTime(c.start, '.')} --> ${formatTime(c.end, '.')}\n${c.text.replace(/-->/g, '- ->')}\n`).join('\n')}`;
}
