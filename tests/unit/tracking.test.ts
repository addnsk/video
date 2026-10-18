import { describe, expect, it } from 'vitest';
import { applyTrack, frameToSource, sourceToFrame, trackPath } from '../../src/core/tracking';
import { createMediaItem } from '../../src/core/operations';
import { emptyProject, type AssetMeta, type MediaItem, type Project } from '../../src/core/model';

const asset = { id: 'a', width: 1920, height: 1080, fps: 25, start: 0, end: 10, hasVideo: true } as AssetMeta;
const settings = { width: 1280, height: 720, fps: 25, sampleRate: 48000 };

describe('tracking', () => {
  const item = { ...createMediaItem(asset, { in: 2, out: 6 }), speed: 2, transform: { x: 0.1, y: -0.05, scale: 0.5, rotation: 0 } } as MediaItem;

  it('maps source points to frame space and back', () => {
    const frame = sourceToFrame(item, asset, settings, { x: 0.75, y: 0.25 });
    expect(frame.x).toBeCloseTo(0.225);
    expect(frame.y).toBeCloseTo(-0.175);
    const back = frameToSource(item, asset, settings, frame);
    expect(back.x).toBeCloseTo(0.75);
    expect(back.y).toBeCloseTo(0.25);
  });

  it('converts source time to clip time and drops weak matches', () => {
    const project: Project = { ...emptyProject(), settings, assets: { a: asset } };
    const path = trackPath(project, item, [
      { time: 2, x: 0.5, y: 0.5, confidence: 1 },
      { time: 3, x: 0.5, y: 0.5, confidence: 0.2 },
      { time: 4, x: 0.5, y: 0.5, confidence: 0.9 },
    ]);
    expect(path.map((p) => p.t)).toEqual([0, 1]);
  });

  it('builds follow and stabilize keyframes', () => {
    const path = [{ t: 0, x: 0, y: 0 }, { t: 1, x: 0.1, y: -0.2 }];
    const project: Project = { ...emptyProject(), tracks: [{ id: 'v1', kind: 'video', magnetic: true, muted: false, items: [item] }] };
    const run = (ops: ReturnType<typeof applyTrack>) => ops.reduce((p, op) => op(p), project).tracks[0].items[0].animations;
    const follow = run(applyTrack(item.id, path, { node: 'n1', param: 'center' }, item.transform));
    expect(follow['node.n1.center.0'].map((k) => k.v)).toEqual([0, 0.1]);
    expect(follow['node.n1.center.1'].map((k) => k.v)).toEqual([0, -0.2]);
    const stable = run(applyTrack(item.id, path, 'stabilize', item.transform));
    expect(stable['transform.x'].map((k) => k.v)).toEqual([0.1, 0]);
    expect(stable['transform.y'][1].v).toBeCloseTo(0.15);
  });
});

describe('tracking with rotated and animated clips', () => {
  const base = createMediaItem(asset, { in: 0, out: 4 });
  it('round-trips through rotation', () => {
    const item = { ...base, transform: { x: 0.1, y: -0.05, scale: 0.7, rotation: 37 } } as MediaItem;
    for (const point of [{ x: 0.2, y: 0.8 }, { x: 0.9, y: 0.1 }]) {
      const back = frameToSource(item, asset, settings, sourceToFrame(item, asset, settings, point));
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
    const right = sourceToFrame({ ...item, transform: { x: 0, y: 0, scale: 1, rotation: 90 } } as MediaItem, asset, settings, { x: 1, y: 0.5 });
    expect(right.x).toBeCloseTo(0, 9);
    expect(right.y).toBeLessThan(0);
  });

  it('follows the clip position at each sample time', () => {
    const item = { ...base, animations: { 'transform.x': [{ t: 0, v: 0 }, { t: 2, v: 0.2 }] } } as MediaItem;
    expect(sourceToFrame(item, asset, settings, { x: 0.5, y: 0.5 }, 1).x).toBeCloseTo(0.1, 9);
    const project: Project = { ...emptyProject(), settings, assets: { a: asset } };
    const path = trackPath(project, item, [{ time: 2, x: 0.5, y: 0.5, confidence: 1 }]);
    expect(path[0].x).toBeCloseTo(0.2, 9);
  });
});
