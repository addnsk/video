import { PROPERTY } from './animation';
import { nodeProperty } from './graph';
import type { AssetMeta, MediaItem, Project, ProjectSettings, Transform } from './model';
import { resolveItem } from './resolve';
import { setKeyframe, type Operation } from './operations';

export interface TrackPoint {
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
}

export interface FramePoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export type TrackApply = { readonly node: string; readonly param: string } | 'stabilize';

export const MIN_TRACK_CONFIDENCE = 0.5;

const transformAt = (item: MediaItem, local: number): Transform => resolveItem(item, local).transform;

const extentOf = (item: MediaItem, asset: AssetMeta, settings: ProjectSettings, transform: Transform) => {
  const scale = Math.min(settings.width / asset.width, settings.height / asset.height) * Math.max(0.001, transform.scale);
  return { w: asset.width * scale, h: asset.height * scale };
};

export function sourceToFrame(item: MediaItem, asset: AssetMeta, settings: ProjectSettings, point: { x: number; y: number }, local = 0): { x: number; y: number } {
  const transform = transformAt(item, local);
  const { w, h } = extentOf(item, asset, settings, transform);
  const angle = (transform.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const dx = (point.x - 0.5) * w;
  const dy = (point.y - 0.5) * h;
  return {
    x: transform.x + (c * dx + s * dy) / settings.width,
    y: transform.y + (-s * dx + c * dy) / settings.height,
  };
}

export function frameToSource(item: MediaItem, asset: AssetMeta, settings: ProjectSettings, point: { x: number; y: number }, local = 0): { x: number; y: number } {
  const transform = transformAt(item, local);
  const { w, h } = extentOf(item, asset, settings, transform);
  const angle = (transform.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const dx = (point.x - transform.x) * settings.width;
  const dy = (point.y - transform.y) * settings.height;
  return {
    x: 0.5 + (c * dx - s * dy) / w,
    y: 0.5 + (s * dx + c * dy) / h,
  };
}

export function trackPath(project: Project, item: MediaItem, samples: readonly TrackPoint[]): FramePoint[] {
  const asset = project.assets[item.source.assetId];
  const settings = project.settings;
  if (!asset || !settings) return [];
  return samples
    .filter((s) => s.confidence >= MIN_TRACK_CONFIDENCE)
    .map((s) => {
      const t = (s.time - item.source.in) / item.speed;
      return { t, ...sourceToFrame(item, asset, settings, s, t) };
    });
}

export function applyTrack(itemId: string, path: readonly FramePoint[], target: TrackApply, base: { x: number; y: number }): Operation[] {
  if (!path.length) return [];
  if (target === 'stabilize') {
    const [first] = path;
    return path.flatMap((p) => [
      setKeyframe(itemId, PROPERTY.x, p.t, base.x - (p.x - first.x)),
      setKeyframe(itemId, PROPERTY.y, p.t, base.y - (p.y - first.y)),
    ]);
  }
  return path.flatMap((p) => [
    setKeyframe(itemId, nodeProperty(target.node, `${target.param}.0`), p.t, p.x),
    setKeyframe(itemId, nodeProperty(target.node, `${target.param}.1`), p.t, p.y),
  ]);
}
