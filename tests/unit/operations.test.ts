import { describe, expect, it } from 'vitest';
import { emptyProject, type Project } from '../../src/core/model';
import {
  addAsset,
  addTrack,
  clearAnimation,
  copyEffects,
  createMediaItem,
  deleteKeyframe,
  insertItem,
  insertText,
  moveToTrack,
  placeItem,
  removeItem,
  removeTrack,
  replaceEffect,
  sequence,
  setDuration,
  setSpeed,
  setItemProps,
  setKeyframe,
  setTextStyle,
  setTrackMuted,
  setTransition,
  splitAt,
  trimItem,
  upsertEffect,
} from '../../src/core/operations';
import { compositionAt, placeTrack } from '../../src/core/timeline';
import { asset } from './fixtures';

const music = { ...asset('music', 30), hasVideo: false, width: 0, height: 0, fps: 0 };
const base = () =>
  sequence(
    addAsset(asset('a', 10)),
    addAsset(music),
    insertItem('a', { trackId: 'v1', in: 0, out: 4, id: 'one' }),
    insertItem('a', { trackId: 'v1', in: 4, out: 8, id: 'two' }),
  )(emptyProject());
const item = (p: Project, id: string) => p.tracks.flatMap((t) => t.items).find((i) => i.id === id)!;
const track = (p: Project, id: string) => p.tracks.find((t) => t.id === id)!;

describe('text operations', () => {
  it('styles and resizes text, ignoring media', () => {
    const p = sequence(insertText('v2', 1, 2, { content: 'Hi' }, 't'), setTextStyle('t', { size: 99 }), setDuration('t', 5), setDuration('one', 1))(base());
    const text = item(p, 't');
    expect(text.kind === 'text' && text.text.content).toBe('Hi');
    expect(text.kind === 'text' && text.text.size).toBe(99);
    expect(text.kind === 'text' && text.duration).toBe(5);
    expect(item(p, 'one')).toEqual(item(base(), 'one'));
  });

  it('trims text start on free tracks and splits text', () => {
    const p = sequence(insertText('v2', 1, 4, {}, 't'), trimItem('t', { in: 1 }))(base());
    const trimmed = item(p, 't');
    expect(trimmed.start).toBe(2);
    expect(trimmed.kind === 'text' && trimmed.duration).toBe(3);
    const split = splitAt(3, 'v2', 'r')(p);
    expect(track(split, 'v2').items.map((i) => i.id)).toEqual(['t', 'r']);
    expect(item(split, 'r').start).toBe(3);
  });
});

describe('media items', () => {
  it('creates items clamped to the asset and places them', () => {
    const created = createMediaItem(asset('a', 10), { in: -1, out: 20, start: -3 });
    expect(created.source).toEqual({ assetId: 'a', in: 0, out: 10 });
    expect(created.start).toBe(0);
    expect(() => createMediaItem(asset('a', 10), { in: 5, out: 5 })).toThrow('Empty source range');
    const p = sequence(placeItem({ ...created, id: 'front' }, 'v1', { index: 0 }), placeItem({ ...created, id: 'pip' }, 'v2', { start: 4 }))(base());
    expect(track(p, 'v1').items.map((i) => i.id)).toEqual(['front', 'one', 'two']);
    expect(item(p, 'pip').start).toBe(4);
  });

  it('copies asset default effects with fresh ids', () => {
    const logAsset = { ...asset('log', 5), defaultEffects: [{ type: 'grade', params: { inputTransform: 'bmdFilmGen5' } }] };
    const [a, b] = [createMediaItem(logAsset), createMediaItem(logAsset)];
    expect(a.effects).toMatchObject([{ type: 'grade', enabled: true, params: { inputTransform: 'bmdFilmGen5' } }]);
    expect(a.effects[0].id).not.toBe(b.effects[0].id);
  });

  it('refuses items a track cannot hold', () => {
    const song = createMediaItem({ ...asset('music', 30), hasVideo: false });
    expect(() => placeItem(song, 'v2')(sequence(addAsset({ ...asset('music', 30), hasVideo: false }))(base()))).toThrow('cannot hold');
  });
});

describe('speed', () => {
  it('changes length, source mapping and keyframe timing', () => {
    let p = sequence(setKeyframe('one', 'opacity', 2, 0.5), setSpeed('one', 2))(base());
    const one = item(p, 'one');
    expect(one.kind === 'media' && one.speed).toBe(2);
    expect(one.animations.opacity[0].t).toBe(1);
    const [first, second] = placeTrack(track(p, 'v1'));
    expect(first.end).toBe(2);
    expect(second.start).toBe(2);
    expect(compositionAt(p, 1.5).layers[0].base.sourceTime).toBe(3);
    p = setSpeed('one', 100)(p);
    const fast = item(p, 'one');
    expect(fast.kind === 'media' && fast.speed).toBe(16);
  });

  it('splits and trims in source time', () => {
    const p = sequence(setSpeed('one', 2), splitAt(1, 'v1', 'r'))(base());
    const [left, right] = [item(p, 'one'), item(p, 'r')];
    expect(left.kind === 'media' && left.source.out).toBe(2);
    expect(right.kind === 'media' && [right.source.in, right.speed]).toEqual([2, 2]);
    const q = sequence(moveToTrack('two', 'v2', { start: 4 }), setSpeed('two', 2), trimItem('two', { in: 6 }))(base());
    expect(item(q, 'two').start).toBe(5);
  });

  it('ignores text items', () => {
    const p = insertText('v2', 0, 2, {}, 't')(base());
    expect(setSpeed('t', 2)(p)).toBe(p);
  });
});

describe('moves', () => {
  it('rejects audio-only media on video tracks and text on audio tracks', () => {
    const p = sequence(insertItem('music', { trackId: 'a1', id: 'song' }), insertText('v2', 0, 1, {}, 't'))(base());
    expect(moveToTrack('song', 'v2', { start: 0 })(p)).toBe(p);
    expect(moveToTrack('t', 'a1', { start: 0 })(p)).toBe(p);
  });

  it('drops transitions when leaving the magnetic track', () => {
    const p = sequence(setTransition('two', { type: 'dissolve', duration: 1, params: {} }), moveToTrack('two', 'v2', { start: 6 }))(base());
    expect(track(p, 'v1').items.map((i) => i.id)).toEqual(['one']);
    expect(item(p, 'two').transitionIn).toBeNull();
    expect(item(p, 'two').start).toBe(6);
  });

  it('clears the first transition after removing the head', () => {
    const p = sequence(setTransition('two', { type: 'dissolve', duration: 1, params: {} }), removeItem('one'))(base());
    expect(item(p, 'two').transitionIn).toBeNull();
  });
});

describe('trim clamps', () => {
  it('keeps media within asset bounds and minimum length', () => {
    const p = sequence(trimItem('one', { in: -5 }), trimItem('two', { out: 50 }))(base());
    const one = item(p, 'one');
    const two = item(p, 'two');
    expect(one.kind === 'media' && one.source.in).toBe(0);
    expect(two.kind === 'media' && two.source.out).toBe(10);
    const tiny = trimItem('one', { in: 100 })(base());
    const t = item(tiny, 'one');
    expect(t.kind === 'media' && t.source.out - t.source.in).toBeGreaterThan(0);
  });
});

describe('item properties and keyframes', () => {
  it('clamps volume and opacity and merges transform', () => {
    const p = setItemProps('one', { volume: -1, opacity: 3, transform: { x: 0.2 } })(base());
    const one = item(p, 'one');
    expect(one.volume).toBe(0);
    expect(one.opacity).toBe(1);
    expect(one.transform.x).toBe(0.2);
    expect(one.transform.scale).toBe(1);
  });

  it('deletes keyframes and drops empty animations', () => {
    let p = sequence(setKeyframe('one', 'opacity', 0, 0), setKeyframe('one', 'opacity', 1, 1))(base());
    p = deleteKeyframe('one', 'opacity', 0)(p);
    expect(item(p, 'one').animations.opacity).toHaveLength(1);
    p = deleteKeyframe('one', 'opacity', 1)(p);
    expect(item(p, 'one').animations.opacity).toBeUndefined();
    const q = sequence(setKeyframe('one', 'transform.x', 0, 1), clearAnimation('one', 'transform.x'))(base());
    expect(item(q, 'one').animations['transform.x']).toBeUndefined();
    expect(clearAnimation('one', 'opacity')(base())).toEqual(base());
  });
});

describe('effects', () => {
  it('upserts by type and merges params', () => {
    const p = sequence(upsertEffect('one', 'grade', { exposure: 1 }), upsertEffect('one', 'grade', { contrast: 2 }))(base());
    expect(item(p, 'one').effects).toHaveLength(1);
    expect(item(p, 'one').effects[0].params).toEqual({ exposure: 1, contrast: 2 });
  });

  it('replaces in place and keeps order and id', () => {
    let p = sequence(upsertEffect('one', 'grade', { a: 1 }), upsertEffect('one', 'lut', { b: 1 }))(base());
    const id = item(p, 'one').effects[0].id;
    p = replaceEffect('one', 'grade', { c: 1 })(p);
    expect(item(p, 'one').effects.map((e) => e.type)).toEqual(['grade', 'lut']);
    expect(item(p, 'one').effects[0]).toMatchObject({ id, params: { c: 1 } });
    p = replaceEffect('one', 'grade', null)(p);
    expect(item(p, 'one').effects.map((e) => e.type)).toEqual(['lut']);
    expect(replaceEffect('one', 'missing', null)(p)).toBe(p);
  });

  it('copies effects with fresh ids', () => {
    const p = sequence(upsertEffect('one', 'grade', { a: 1 }), copyEffects('one', ['one', 'two']))(base());
    const [src, dst] = [item(p, 'one').effects[0], item(p, 'two').effects[0]];
    expect(dst.params).toEqual(src.params);
    expect(dst.id).not.toBe(src.id);
  });
});

describe('tracks', () => {
  it('adds tracks after the last of their kind', () => {
    const p = sequence(addTrack('video', 'v3'), addTrack('audio', 'a2'))(base());
    expect(p.tracks.map((t) => t.id)).toEqual(['v1', 'v2', 'v3', 'a1', 'a2']);
  });

  it('never removes the magnetic track', () => {
    const p = base();
    expect(removeTrack('v1')(p)).toBe(p);
    expect(removeTrack('v2')(p).tracks.map((t) => t.id)).toEqual(['v1', 'a1']);
  });

  it('mutes tracks', () => {
    expect(track(setTrackMuted('a1', true)(base()), 'a1').muted).toBe(true);
  });
});

describe('node keyframes follow copies', () => {
  it('split and copied grades keep node keyframes on the new node ids', async () => {
    const { splitAt, copyEffects } = await import('../../src/core/operations');
    const { emptyProject } = await import('../../src/core/model');
    const base = emptyProject();
    const item = {
      id: 'left', kind: 'media' as const, start: 0, source: { assetId: 'x', in: 0, out: 4 }, speed: 1,
      effects: [{ id: 'n1', type: 'blur', enabled: true, params: {} }],
      transitionIn: null, volume: 1, opacity: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      animations: { 'node.n1.radius': [{ t: 1, v: 0 }, { t: 3, v: 8 }], opacity: [{ t: 3, v: 1 }] },
      presets: {}, graph: { links: [{ from: 'source', to: 'n1', input: 'source' }, { from: 'n1', to: 'output', input: 'input' }], positions: {} },
    };
    const other = { ...item, id: 'other', start: 4, effects: [], graph: undefined, animations: { 'node.old.radius': [{ t: 0, v: 1 }] } };
    const project = { ...base, tracks: [{ ...base.tracks[0], items: [item, other] }, ...base.tracks.slice(1)] };
    const split = splitAt(2, 'v1', 'right')(project);
    const right = split.tracks[0].items.find((i) => i.id === 'right')!;
    const rightNode = right.effects[0].id;
    expect(rightNode).not.toBe('n1');
    expect(Object.keys(right.animations)).toContain(`node.${rightNode}.radius`);
    expect(right.animations[`node.${rightNode}.radius`]).toEqual([{ t: 0, v: 4 }, { t: 1, v: 8 }]);
    const copied = copyEffects('left', ['other'])(project).tracks[0].items[1];
    const copiedNode = copied.effects[0].id;
    expect(Object.keys(copied.animations)).toEqual([`node.${copiedNode}.radius`]);
  });
});
