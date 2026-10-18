import type { Item, Project, Track, TransitionInstance } from './model';
import { itemLength } from './model';

export interface Placement {
  readonly item: Item;
  readonly track: Track;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
}

export interface LayerFrame {
  readonly placement: Placement;
  readonly sourceTime: number;
}

export interface TransitionFrame {
  readonly incoming: LayerFrame;
  readonly transition: TransitionInstance;
  readonly progress: number;
}

export interface TrackFrame {
  readonly track: Track;
  readonly base: LayerFrame;
  readonly transition: TransitionFrame | null;
}

export interface CompositionFrame {
  readonly time: number;
  readonly layers: readonly TrackFrame[];
}

const MAX_TRANSITION_SHARE = 0.9;

export function transitionLength(track: Track, index: number): number {
  const item = track.items[index];
  const prev = track.items[index - 1];
  if (!track.magnetic || !item?.transitionIn || !prev) return 0;
  const limit = Math.min(itemLength(prev), itemLength(item)) * MAX_TRANSITION_SHARE;
  return Math.max(0, Math.min(item.transitionIn.duration, limit));
}

const cache = new WeakMap<Track, readonly Placement[]>();

export function placeTrack(track: Track): readonly Placement[] {
  const cached = cache.get(track);
  if (cached) return cached;
  const out: Placement[] = [];
  let cursor = 0;
  track.items.forEach((item, index) => {
    const fadeIn = transitionLength(track, index);
    const start = track.magnetic ? cursor - fadeIn : item.start;
    const end = start + itemLength(item);
    out.push({ item, track, index, start, end, fadeIn, fadeOut: transitionLength(track, index + 1) });
    cursor = end;
  });
  if (!track.magnetic) out.sort((a, b) => a.start - b.start);
  cache.set(track, out);
  return out;
}

export function projectDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) for (const p of placeTrack(track)) end = Math.max(end, p.end);
  return end;
}

export function findPlacement(project: Project, itemId: string): Placement | null {
  for (const track of project.tracks) {
    const hit = placeTrack(track).find((p) => p.item.id === itemId);
    if (hit) return hit;
  }
  return null;
}

const layerAt = (placement: Placement, time: number): LayerFrame => ({
  placement,
  sourceTime: placement.item.source.in + (time - placement.start),
});

export function trackFrameAt(track: Track, time: number): TrackFrame | null {
  const placements = placeTrack(track);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (time < p.start || time >= p.end) continue;
    const next = placements[i + 1];
    if (track.magnetic && next?.item.transitionIn && next.fadeIn > 0 && time >= next.start) {
      return {
        track,
        base: layerAt(p, time),
        transition: {
          incoming: layerAt(next, time),
          transition: next.item.transitionIn,
          progress: (time - next.start) / next.fadeIn,
        },
      };
    }
    return { track, base: layerAt(p, time), transition: null };
  }
  return null;
}

export function compositionAt(project: Project, time: number): CompositionFrame {
  const layers: TrackFrame[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.muted) continue;
    const frame = trackFrameAt(track, time);
    if (frame) layers.push(frame);
  }
  return { time, layers };
}

export function audibleAt(project: Project, t0: number, t1: number): Placement[] {
  const out: Placement[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const p of placeTrack(track)) if (p.end > t0 && p.start < t1) out.push(p);
  }
  return out;
}
