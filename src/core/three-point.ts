import type { Project, Track } from './model';
import { MAX_SPEED, MIN_SPEED } from './model';
import { createMediaItem } from './operations';

export interface MarkRange {
  readonly in?: number;
  readonly out?: number;
}

export interface ThreePointInput {
  readonly source: MarkRange & { readonly playhead: number; readonly start: number; readonly end: number };
  readonly record: MarkRange & { readonly playhead: number };
}

export interface ThreePointEdit {
  readonly sourceIn: number;
  readonly sourceOut: number;
  readonly recordIn: number;
  readonly speed: number;
}

const MIN_EDIT = 1 / 120;

export function resolveThreePoint({ source, record }: ThreePointInput): ThreePointEdit {
  const clampSource = (t: number) => Math.min(source.end, Math.max(source.start, t));
  const recordLength = record.in !== undefined && record.out !== undefined ? record.out - record.in : undefined;
  if (recordLength !== undefined && recordLength < MIN_EDIT) throw new Error('Timeline In must be before Out');
  if (source.in !== undefined && source.out !== undefined && source.out - source.in < MIN_EDIT) throw new Error('Source In must be before Out');

  if (source.in !== undefined && source.out !== undefined && recordLength !== undefined) {
    const sourceIn = clampSource(source.in);
    const sourceOut = clampSource(source.out);
    const speed = (sourceOut - sourceIn) / recordLength;
    if (speed < MIN_SPEED || speed > MAX_SPEED) throw new Error(`Fit to fill needs a speed between ${MIN_SPEED} and ${MAX_SPEED}, got ${speed.toFixed(3)}`);
    return { sourceIn, sourceOut, recordIn: record.in!, speed };
  }

  if (recordLength !== undefined) {
    if (source.out !== undefined && source.in === undefined) {
      const sourceOut = clampSource(source.out);
      const sourceIn = clampSource(sourceOut - recordLength);
      return { sourceIn, sourceOut, recordIn: record.out! - (sourceOut - sourceIn), speed: 1 };
    }
    const sourceIn = clampSource(source.in ?? source.playhead);
    return { sourceIn, sourceOut: clampSource(sourceIn + recordLength), recordIn: record.in!, speed: 1 };
  }

  const sourceIn = clampSource(source.in ?? source.playhead);
  const sourceOut = clampSource(source.out ?? source.end);
  if (sourceOut - sourceIn < MIN_EDIT) throw new Error('Nothing to edit: the source range is empty');
  if (record.in === undefined && record.out !== undefined) return { sourceIn, sourceOut, recordIn: Math.max(0, record.out - (sourceOut - sourceIn)), speed: 1 };
  return { sourceIn, sourceOut, recordIn: record.in ?? record.playhead, speed: 1 };
}

export const SOURCE_ITEM_ID = 'source';

export function sourceProject(timeline: Project, assetId: string): Project {
  const asset = timeline.assets[assetId];
  if (!asset) throw new Error(`Unknown asset ${assetId}`);
  const settings = timeline.settings ?? { width: asset.width || 1920, height: asset.height || 1080, fps: asset.fps || 25, sampleRate: 48000 };
  const item = createMediaItem(asset, { id: SOURCE_ITEM_ID });
  const tracks: Track[] = [
    { id: 'v1', kind: 'video', magnetic: true, muted: false, items: asset.hasVideo ? [item] : [] },
    { id: 'a1', kind: 'audio', magnetic: false, muted: false, items: asset.hasVideo ? [] : [item] },
  ];
  const { mix: _mix, markers: _markers, ...rest } = timeline;
  return { ...rest, settings, tracks };
}
