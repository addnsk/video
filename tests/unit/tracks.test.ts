import { describe, expect, it } from 'vitest';
import { PROPERTY, resolveItem, valueAt } from '../../src/core/animation';
import { migrateProject } from '../../src/core/migrate';
import { emptyProject } from '../../src/core/model';
import {
  addAsset,
  addTrack,
  insertItem,
  insertText,
  moveToTrack,
  sequence,
  setKeyframe,
  splitAt,
  trimItem,
} from '../../src/core/operations';
import { audibleAt, compositionAt, findPlacement, projectDuration } from '../../src/core/timeline';
import { asset } from './fixtures';

const music = { ...asset('music', 30), hasVideo: false, width: 0, height: 0, fps: 0 };

const build = () =>
  sequence(
    addAsset(asset('a', 10)),
    addAsset(music),
    insertItem('a', { trackId: 'v1', in: 0, out: 6, id: 'main' }),
    insertItem('a', { trackId: 'v2', in: 2, out: 4, start: 1, id: 'pip' }),
    insertText('v2', 4, 2, { content: 'Hello' }, 'title'),
    insertItem('music', { trackId: 'a1', start: 0.5, id: 'song' }),
  )(emptyProject());

describe('multiple tracks', () => {
  it('stacks video tracks bottom to top', () => {
    const frame = compositionAt(build(), 1.5);
    expect(frame.layers.map((l) => l.base.placement.item.id)).toEqual(['main', 'pip']);
    expect(frame.layers[1].base.sourceTime).toBeCloseTo(2.5);
  });

  it('renders titles as layers with local time', () => {
    const frame = compositionAt(build(), 5);
    expect(frame.layers[1].base.placement.item.kind).toBe('text');
    expect(frame.layers[1].base.local).toBeCloseTo(1);
  });

  it('draws every overlapping item of a free track', () => {
    const project = insertText('v2', 1.5, 1, { content: 'Over' }, 'over')(build());
    expect(compositionAt(project, 2).layers.map((l) => l.base.placement.item.id)).toEqual(['main', 'pip', 'over']);
  });

  it('extends the duration with free tracks', () => {
    expect(projectDuration(build())).toBeCloseTo(30.5);
  });

  it('refuses audio-only media on video tracks', () => {
    expect(() => insertItem('music', { trackId: 'v1' })(build())).toThrow();
  });

  it('moves items between tracks', () => {
    const project = moveToTrack('pip', 'v1', { index: 0 })(build());
    expect(project.tracks[0].items.map((i) => i.id)).toEqual(['pip', 'main']);
    expect(project.tracks[1].items.map((i) => i.id)).toEqual(['title']);
  });

  it('keeps free items in place when trimming the head', () => {
    const project = trimItem('pip', { in: 3 })(build());
    const p = findPlacement(project, 'pip')!;
    expect(p.start).toBeCloseTo(2);
    expect(p.end).toBeCloseTo(3);
  });

  it('hears audio on every unmuted track', () => {
    expect(audibleAt(build(), 1, 2).map((p) => p.item.id).sort()).toEqual(['main', 'pip', 'song']);
  });

  it('adds tracks next to their kind', () => {
    const project = addTrack('video', 'v3')(build());
    expect(project.tracks.map((t) => t.id)).toEqual(['v1', 'v2', 'v3', 'a1']);
  });
});

describe('animation', () => {
  it('interpolates keyframes and clamps outside', () => {
    const keys = [{ t: 1, v: 0 }, { t: 3, v: 1 }];
    expect(valueAt(keys, 0, 5)).toBe(0);
    expect(valueAt(keys, 2, 5)).toBeCloseTo(0.5);
    expect(valueAt(keys, 9, 5)).toBe(1);
    expect(valueAt(undefined, 2, 5)).toBe(5);
  });

  it('resolves animated properties of an item', () => {
    const project = sequence(setKeyframe('pip', PROPERTY.opacity, 0, 0), setKeyframe('pip', PROPERTY.opacity, 2, 1))(build());
    const item = findPlacement(project, 'pip')!.item;
    expect(resolveItem(item, 1).opacity).toBeCloseTo(0.5);
  });

  it('splits animations with the clip', () => {
    const project = sequence(setKeyframe('pip', PROPERTY.scale, 0, 1), setKeyframe('pip', PROPERTY.scale, 2, 2), splitAt(2, 'v2', 'right'))(build());
    const right = findPlacement(project, 'right')!.item;
    expect(right.animations[PROPERTY.scale]).toEqual([{ t: 1, v: 2 }]);
  });
});

describe('migration', () => {
  it('upgrades version 1 projects', () => {
    const v1 = {
      version: 1,
      settings: null,
      assets: { a: { ...asset('a'), hasVideo: undefined } },
      tracks: [
        { id: 'v1', kind: 'video', magnetic: true, muted: false, items: [{ id: 'x', source: { assetId: 'a', in: 0, out: 1 }, start: 0, effects: [], transitionIn: null, volume: 1 }] },
        { id: 'a1', kind: 'audio', magnetic: false, muted: false, items: [] },
      ],
    };
    const project = migrateProject(v1);
    expect(project.version).toBe(2);
    expect(project.tracks.map((t) => t.id)).toEqual(['v1', 'v2', 'a1']);
    expect(project.tracks[0].items[0]).toMatchObject({ kind: 'media', opacity: 1, transform: { scale: 1 } });
    expect(project.assets.a.hasVideo).toBe(true);
  });
});
