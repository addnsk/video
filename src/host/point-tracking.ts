import { itemLength } from '../core/model';
import { findPlacement } from '../core/timeline';
import { applyTrack, frameToSource, trackPath, type FramePoint, type TrackApply } from '../core/tracking';
import type { EditorSession } from './session';

export interface TrackRequest {
  readonly x: number;
  readonly y: number;
  readonly from?: number;
  readonly to?: number;
  readonly apply?: TrackApply;
  readonly patch?: number;
  readonly search?: number;
  readonly height?: number;
}

const MAX_TRACK_FRAMES = 100000;

export async function trackPoint(session: EditorSession, itemId: string, request: TrackRequest): Promise<FramePoint[]> {
  const { store } = session;
  const item = findPlacement(store.project, itemId)?.item;
  if (item?.kind !== 'media') throw new Error('Only media clips can be tracked');
  const asset = store.project.assets[item.source.assetId];
  const settings = store.project.settings;
  if (!asset?.hasVideo || !settings) throw new Error('The clip has no video');
  const length = itemLength(item);
  const from = Math.max(0, Math.min(length, request.from ?? 0));
  const to = Math.max(from, Math.min(length, request.to ?? length));
  const step = item.speed / (asset.fps || settings.fps);
  const times: number[] = [];
  for (let s = item.source.in + from * item.speed; s <= item.source.in + to * item.speed + 1e-6 && times.length < MAX_TRACK_FRAMES; s += step) times.push(s);
  const samples = await session.engine.remote.track(asset.id, times, frameToSource(item, asset, settings, request), {
    patch: request.patch ?? 21,
    search: request.search ?? 16,
    height: request.height ?? 360,
  });
  const current = findPlacement(store.project, itemId)?.item;
  if (current?.kind !== 'media') return [];
  const path = trackPath(store.project, current, samples);
  if (request.apply) {
    const ops = applyTrack(itemId, path, request.apply, current.transform);
    await store.transaction(() => ops.forEach((op) => store.dispatch(op)));
  }
  return path;
}
