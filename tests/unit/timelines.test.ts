import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/core/migrate';
import { emptyProject, type Project } from '../../src/core/model';
import { addAsset, insertItem, insertText, sequence, trimItem } from '../../src/core/operations';
import { allLayersOf, compositionAt, projectDuration } from '../../src/core/timeline';
import {
  activeTimeline,
  addTimeline,
  canNest,
  duplicateTimeline,
  ensureNestedAsset,
  nestItems,
  nestedAssetId,
  removeTimeline,
  renameTimeline,
  setTimelineFormat,
  switchTimeline,
  timelineList,
} from '../../src/core/timelines';
import { asset } from './fixtures';

const base = () =>
  sequence(
    addAsset(asset('a', 10)),
    insertItem('a', { trackId: 'v1', in: 0, out: 4, id: 'one' }),
    insertItem('a', { trackId: 'v1', in: 4, out: 6, id: 'two' }),
  )({ ...emptyProject(), settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000 } });

const ids = (p: Project, track = 'v1') => p.tracks.find((t) => t.id === track)!.items.map((i) => i.id);

describe('timelines', () => {
  it('creates, switches and keeps each timeline separate', () => {
    let p = addTimeline('B', 'tb')(base());
    expect(timelineList(p).map((t) => [t.name, t.active])).toEqual([['Timeline 1', true], ['B', false]]);
    p = switchTimeline('tb')(p);
    expect(activeTimeline(p)).toEqual({ id: 'tb', name: 'B' });
    expect(projectDuration(p)).toBe(0);
    p = insertItem('a', { trackId: 'v1', in: 0, out: 1, id: 'b1' })(p);
    p = switchTimeline('timeline_main')(p);
    expect(ids(p)).toEqual(['one', 'two']);
    p = switchTimeline('tb')(p);
    expect(ids(p)).toEqual(['b1']);
  });

  it('renames, duplicates with fresh ids and refuses to delete the open timeline', () => {
    let p = renameTimeline('timeline_main', 'Edit')(base());
    expect(activeTimeline(p).name).toBe('Edit');
    p = duplicateTimeline('timeline_main', 'copy')(p);
    expect(p.timelines!.copy.name).toBe('Edit copy');
    expect(p.timelines!.copy.tracks[0].items.map((i) => i.id)).not.toContain('one');
    expect(() => removeTimeline('timeline_main')(p)).toThrow(/Switch/);
    expect(timelineList(removeTimeline('copy')(p))).toHaveLength(1);
    expect(addTimeline('Edit')(p).timelines).toMatchObject({});
    expect(timelineList(addTimeline('Edit')(p)).map((t) => t.name)).toContain('Edit 2');
  });

  it('nests a timeline as a clip and renders its layers inside the parent', () => {
    let p = sequence(addTimeline('Inner', 'in'), switchTimeline('in'), insertItem('a', { trackId: 'v1', in: 7, out: 9, id: 'deep' }), insertText('v2', 0.5, 1, {}, 'label'), switchTimeline('timeline_main'))(base());
    p = ensureNestedAsset('in')(p);
    const meta = p.assets[nestedAssetId('in')];
    expect(meta).toMatchObject({ timeline: 'in', end: 2, name: 'Inner', hasVideo: true });
    p = insertItem(meta.id, { trackId: 'v1', id: 'nest' })(p);
    const frame = compositionAt(p, 6.75);
    const nested = frame.layers[0].base.nested!;
    expect(nested.layers.map((l) => [l.base.placement.item.id, +l.base.sourceTime.toFixed(3)])).toEqual([['nest>deep', 7.75], ['nest>label', 0.25]]);
    expect(allLayersOf(frame).map((l) => l.placement.item.id)).toEqual(['nest', 'nest>deep', 'nest>label']);
  });

  it('refuses cycles and clamps clips when the nested timeline gets shorter', () => {
    let p = sequence(addTimeline('Inner', 'in'), switchTimeline('in'), insertItem('a', { trackId: 'v1', in: 0, out: 3, id: 'deep' }), switchTimeline('timeline_main'), ensureNestedAsset('in'))(base());
    p = insertItem(nestedAssetId('in'), { trackId: 'v1', id: 'nest' })(p);
    p = switchTimeline('in')(p);
    expect(canNest(p, 'timeline_main')).toBe(false);
    expect(() => ensureNestedAsset('timeline_main')(p)).toThrow(/cannot be nested/);
    p = trimItem('deep', { out: 1 })(p);
    p = switchTimeline('timeline_main')(p);
    expect(p.assets[nestedAssetId('in')].end).toBe(1);
    expect(p.tracks[0].items.find((i) => i.id === 'nest')).toMatchObject({ source: { in: 0, out: 1 } });
  });

  it('turns selected clips into a compound clip in place', () => {
    const p = sequence(insertItem('a', { trackId: 'a1', in: 0, out: 4, id: 'snd', start: 0 }), nestItems(['one', 'snd'], 'Scene', 'scene', 'cc'))(base());
    expect(ids(p)).toEqual(['cc', 'two']);
    expect(ids(p, 'a1')).toEqual([]);
    expect(p.timelines!.scene.tracks.find((t) => t.id === 'a1')!.items.map((i) => i.id)).toEqual(['snd']);
    expect(compositionAt(p, 1).layers[0].base.nested!.layers[0].base.placement.item.id).toBe('cc>one');
    expect(removeTimeline('scene')(p).tracks[0].items.map((i) => i.id)).toEqual(['two']);
  });

  it('keeps a frame size and rate per timeline and nests across sizes', () => {
    let p = addTimeline('Vertical', 'vert', undefined, { width: 1080, height: 1920, fps: 30 })(base());
    expect(p.settings).toMatchObject({ width: 1920, height: 1080, fps: 25 });
    p = switchTimeline('vert')(p);
    expect(p.settings).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    p = ensureNestedAsset('timeline_main')(p);
    expect(p.assets[nestedAssetId('timeline_main')]).toMatchObject({ width: 1920, height: 1080, fps: 25 });
    p = setTimelineFormat({ fps: 24 })(p);
    p = switchTimeline('timeline_main')(p);
    expect(p.timelines!.vert.settings).toMatchObject({ width: 1080, height: 1920, fps: 24 });
    expect(p.settings).toMatchObject({ width: 1920, height: 1080, fps: 25 });
    expect(() => setTimelineFormat({ width: 1081 })(p)).toThrow(/even/);
  });

  it('survives save and load', () => {
    const p = sequence(addTimeline('B', 'tb'), ensureNestedAsset('tb'))(base());
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
