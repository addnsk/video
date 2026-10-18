import { PROPERTY } from './animation';
import { nodeProperty } from './graph';
import type { AssetMeta, MediaItem, Project, ProjectSettings } from './model';
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

export function sourceToFrame(item: MediaItem, asset: AssetMeta, settings: ProjectSettings, point: { x: number; y: number }): { x: number; y: number } {
  const scale = Math.min(settings.width / asset.width, settings.height / asset.height) * item.transform.scale;
  return {
    x: item.transform.x + ((point.x - 0.5) * asset.width * scale) / settings.width,
    y: item.transform.y + ((point.y - 0.5) * asset.height * scale) / settings.height,
  };
}

export function frameToSource(item: MediaItem, asset: AssetMeta, settings: ProjectSettings, point: { x: number; y: number }): { x: number; y: number } {
  const scale = Math.min(settings.width / asset.width, settings.height / asset.height) * item.transform.scale;
  return {
    x: 0.5 + ((point.x - item.transform.x) * settings.width) / (asset.width * scale),
    y: 0.5 + ((point.y - item.transform.y) * settings.height) / (asset.height * scale),
  };
}

export function trackPath(project: Project, item: MediaItem, samples: readonly TrackPoint[]): FramePoint[] {
  const asset = project.assets[item.source.assetId];
  const settings = project.settings;
  if (!asset || !settings) return [];
  return samples
    .filter((s) => s.confidence >= MIN_TRACK_CONFIDENCE)
    .map((s) => ({ t: (s.time - item.source.in) / item.speed, ...sourceToFrame(item, asset, settings, s) }));
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
