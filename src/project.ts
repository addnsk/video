import type { Input, InputVideoTrack, InputAudioTrack, VideoSampleSink, AudioBufferSink } from 'mediabunny';
import { type Grade, defaultGrade, cloneGrade } from './grade';

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

/** Переход из предыдущего клипа в этот. Клипы перекрываются на duration секунд. */
export interface Transition {
  type: string;
  duration: number;
  params: Record<string, number | number[]>;
}

export interface Clip {
  id: string;
  assetId: string;
  in: number; // время в исходнике
  out: number;
  grade: Grade;
  transition: Transition | null;
}

/** Слой, видимый в момент времени: клип и где он начинается на таймлайне. */
export interface Layer {
  clip: Clip;
  start: number;
}

export interface Frame {
  layer: Layer;
  /** Есть во время перехода: входящий клип и прогресс 0..1. */
  next?: { layer: Layer; progress: number; transition: Transition };
}

let nextId = 1;
export const uid = (p: string) => `${p}${nextId++}`;

const cloneClip = (c: Clip): Clip => ({
  ...c,
  grade: cloneGrade(c.grade),
  transition: c.transition && { ...c.transition, params: { ...c.transition.params } },
});

export class Project {
  assets = new Map<string, Asset>();
  clips: Clip[] = [];
  selected: string | null = null;
  private listeners = new Set<() => void>();
  private undoStack: Clip[][] = [];
  private redoStack: Clip[][] = [];

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  changed() {
    for (const fn of this.listeners) fn();
  }

  /** Запоминает состояние перед изменением, чтобы его можно было отменить. */
  checkpoint() {
    this.undoStack.push(this.clips.map(cloneClip));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.clips);
    this.restore(prev);
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.clips);
    this.restore(next);
    return true;
  }

  private restore(clips: Clip[]) {
    this.clips = clips;
    if (!clips.some((c) => c.id === this.selected)) this.selected = clips[0]?.id ?? null;
    this.changed();
  }

  get fps() {
    const first = this.clips[0] && this.assets.get(this.clips[0].assetId);
    return first?.fps || 25;
  }

  get size() {
    const first = this.clips[0] && this.assets.get(this.clips[0].assetId);
    return first ? { width: first.width, height: first.height } : { width: 1920, height: 1080 };
  }

  /** Длина перехода с учётом длин обоих клипов. */
  transitionLength(index: number) {
    const clip = this.clips[index];
    const prev = this.clips[index - 1];
    if (!clip?.transition || !prev) return 0;
    const max = Math.min(prev.out - prev.in, clip.out - clip.in) * 0.9;
    return Math.max(0, Math.min(clip.transition.duration, max));
  }

  /** Раскладка: клипы встык, а с переходом входящий клип наезжает на предыдущий. */
  layout(): Layer[] {
    const out: Layer[] = [];
    let t = 0;
    this.clips.forEach((clip, i) => {
      t -= this.transitionLength(i);
      out.push({ clip, start: t });
      t += clip.out - clip.in;
    });
    return out;
  }

  get duration() {
    const l = this.layout().at(-1);
    return l ? l.start + l.clip.out - l.clip.in : 0;
  }

  startOf(clip: Clip) {
    return this.layout().find((l) => l.clip === clip)?.start ?? 0;
  }

  frameAt(time: number): Frame | null {
    const layers = this.layout();
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const end = l.start + l.clip.out - l.clip.in;
      if (time < l.start || time >= end) continue;
      const n = layers[i + 1];
      if (n && time >= n.start && n.clip.transition) {
        const d = end - n.start;
        return { layer: l, next: { layer: n, progress: (time - n.start) / d, transition: n.clip.transition } };
      }
      return { layer: l };
    }
    return null;
  }

  get selectedClip() {
    return this.clips.find((c) => c.id === this.selected) ?? null;
  }

  clip(id: string) {
    const c = this.clips.find((x) => x.id === id);
    if (!c) throw new Error(`Нет клипа ${id}`);
    return c;
  }

  addClip(asset: Asset, range?: { in?: number; out?: number; index?: number }) {
    const clip: Clip = {
      id: uid('c'),
      assetId: asset.id,
      in: Math.max(asset.start, range?.in ?? asset.start),
      out: Math.min(asset.end, range?.out ?? asset.end),
      grade: defaultGrade(),
      transition: null,
    };
    if (clip.out <= clip.in) throw new Error('Пустой диапазон клипа');
    const index = range?.index ?? this.clips.length;
    this.clips.splice(index, 0, clip);
    this.selected = clip.id;
    this.changed();
    return clip;
  }

  split(time: number) {
    const frame = this.frameAt(time);
    if (!frame) return null;
    const { clip, start } = frame.next && frame.next.progress >= 0.5 ? frame.next.layer : frame.layer;
    const cut = clip.in + (time - start);
    const minLen = 1 / this.fps;
    if (cut - clip.in < minLen || clip.out - cut < minLen) return null;
    const right: Clip = { ...cloneClip(clip), id: uid('c'), in: cut, transition: null };
    clip.out = cut;
    this.clips.splice(this.clips.indexOf(clip) + 1, 0, right);
    this.selected = right.id;
    this.changed();
    return right;
  }

  trim(id: string, range: { in?: number; out?: number }) {
    const clip = this.clip(id);
    const asset = this.assets.get(clip.assetId)!;
    const min = 1 / this.fps;
    if (range.in !== undefined) clip.in = Math.min(Math.max(asset.start, range.in), clip.out - min);
    if (range.out !== undefined) clip.out = Math.max(Math.min(asset.end, range.out), clip.in + min);
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
