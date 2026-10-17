import type { Input, InputVideoTrack, InputAudioTrack, VideoSampleSink, AudioBufferSink } from 'mediabunny';
import { type Grade, defaultGrade } from './grade';

export interface Asset {
  id: string;
  name: string;
  file: File;
  input: Input;
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
  frames: VideoSampleSink;
  sound: AudioBufferSink | null;
  codec: string;
  width: number;
  height: number;
  fps: number;
  start: number; // первый таймкод в файле
  end: number;
}

export interface Clip {
  id: string;
  assetId: string;
  in: number; // время в исходнике
  out: number;
  grade: Grade;
}

let nextId = 1;
export const uid = (p: string) => `${p}${nextId++}`;

export class Project {
  assets = new Map<string, Asset>();
  clips: Clip[] = [];
  selected: string | null = null;
  private listeners = new Set<() => void>();

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }
  changed() {
    for (const fn of this.listeners) fn();
  }

  get duration() {
    return this.clips.reduce((s, c) => s + (c.out - c.in), 0);
  }

  get fps() {
    const first = this.clips[0] && this.assets.get(this.clips[0].assetId);
    return first?.fps || 25;
  }

  get size() {
    const first = this.clips[0] && this.assets.get(this.clips[0].assetId);
    return first ? { width: first.width, height: first.height } : { width: 1920, height: 1080 };
  }

  /** Клипы на таймлайне стоят встык, без дыр. */
  startOf(clip: Clip) {
    let t = 0;
    for (const c of this.clips) {
      if (c === clip) return t;
      t += c.out - c.in;
    }
    return t;
  }

  clipAt(time: number): { clip: Clip; start: number } | null {
    let t = 0;
    for (const clip of this.clips) {
      const d = clip.out - clip.in;
      if (time < t + d) return { clip, start: t };
      t += d;
    }
    return null;
  }

  addClip(asset: Asset) {
    const clip: Clip = { id: uid('c'), assetId: asset.id, in: asset.start, out: asset.end, grade: defaultGrade() };
    this.clips.push(clip);
    this.selected = clip.id;
    this.changed();
    return clip;
  }

  get selectedClip() {
    return this.clips.find((c) => c.id === this.selected) ?? null;
  }

  split(time: number) {
    const hit = this.clipAt(time);
    if (!hit) return;
    const { clip, start } = hit;
    const cut = clip.in + (time - start);
    const minLen = 1 / this.fps;
    if (cut - clip.in < minLen || clip.out - cut < minLen) return;
    const right: Clip = { ...clip, id: uid('c'), in: cut, grade: structuredClone(clip.grade) };
    clip.out = cut;
    this.clips.splice(this.clips.indexOf(clip) + 1, 0, right);
    this.selected = right.id;
    this.changed();
  }

  remove(id: string) {
    this.clips = this.clips.filter((c) => c.id !== id);
    if (this.selected === id) this.selected = null;
    this.changed();
  }

  move(id: string, index: number) {
    const from = this.clips.findIndex((c) => c.id === id);
    if (from < 0) return;
    const [clip] = this.clips.splice(from, 1);
    this.clips.splice(Math.max(0, Math.min(index, this.clips.length)), 0, clip);
    this.changed();
  }
}
