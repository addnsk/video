import { describe, expect, it } from 'vitest';
import { addBin, binContents, moveToBin, parseQuery, removeAsset, removeBin, renameAsset, searchMedia, setMetadata, updateBin } from '../../src/core/bins';
import { migrateProject } from '../../src/core/migrate';
import { emptyProject } from '../../src/core/model';
import { addAsset, insertItem, sequence } from '../../src/core/operations';
import { asset } from './fixtures';

const wav = { ...asset('song', 30), name: 'song.wav', codec: 'PCM', hasVideo: false, width: 0, height: 0, fps: 0 };
const base = () =>
  sequence(
    addAsset({ ...asset('a', 10), name: 'A001_interview.mov' }),
    addAsset({ ...asset('b', 10), name: 'B002_broll.mov' }),
    addAsset(wav),
    addBin('Footage', null, undefined, 'footage'),
    addBin('Day 1', 'footage', undefined, 'day1'),
  )(emptyProject());
const names = (list: { name: string }[]) => list.map((a) => a.name).sort();

describe('bins', () => {
  it('moves media between bins and lists their contents', () => {
    const p = moveToBin(['a', 'b'], 'day1')(base());
    expect(names(binContents(p, 'day1'))).toEqual(['A001_interview.mov', 'B002_broll.mov']);
    expect(names(binContents(p, null))).toEqual(['song.wav']);
    const removed = removeBin('day1')(p);
    expect(names(binContents(removed, 'footage'))).toEqual(['A001_interview.mov', 'B002_broll.mov']);
    expect(removeBin('footage')(base()).bins).toEqual([{ id: 'day1', name: 'Day 1', parent: null }]);
  });

  it('refuses loops and bad names', () => {
    expect(() => updateBin('footage', { parent: 'day1' })(base())).toThrow(/into itself/);
    expect(() => addBin('  ')(base())).toThrow(/empty/);
    expect(updateBin('day1', { name: 'Day One', parent: null })(base()).bins![1]).toEqual({ id: 'day1', name: 'Day One', parent: null });
  });

  it('stores clean metadata and drops empty fields', () => {
    let p = setMetadata('a', { scene: ' 12 ', take: '3', keywords: ['interview', 'interview', ' ', 'wide'], rating: 4, flagged: true })(base());
    expect(p.media!.a.metadata).toEqual({ scene: '12', take: '3', keywords: ['interview', 'wide'], rating: 4, flagged: true });
    p = setMetadata('a', { scene: null, keywords: [], rating: 0, flagged: false, take: '' })(p);
    expect(p.media).toBeUndefined();
    expect(() => setMetadata('a', { mood: 'x' } as never)(p)).toThrow(/Unknown metadata field/);
    expect(() => setMetadata('a', { rating: 9 })(p)).toThrow(/0–5/);
  });

  it('searches by words, fields, numbers and negation', () => {
    const p = sequence(setMetadata('a', { scene: '12', take: '3', rating: 4, keywords: ['interview'] }), setMetadata('b', { scene: '12', take: '1', rating: 2 }), moveToBin(['b'], 'day1'))(base());
    expect(names(searchMedia(p, 'interview'))).toEqual(['A001_interview.mov']);
    expect(names(searchMedia(p, 'scene:12 rating>=3'))).toEqual(['A001_interview.mov']);
    expect(names(searchMedia(p, 'kind:audio'))).toEqual(['song.wav']);
    expect(names(searchMedia(p, '-kind:audio scene=12'))).toEqual(['A001_interview.mov', 'B002_broll.mov']);
    expect(names(searchMedia(p, 'bin:"day 1"'))).toEqual(['B002_broll.mov']);
    expect(names(searchMedia(p, 'flagged:no codec:prores'))).toEqual(['A001_interview.mov', 'B002_broll.mov']);
    expect(() => parseQuery('mood:happy')).toThrow(/Unknown search field/);
  });

  it('smart bins show their search and refuse manual moves', () => {
    const p = sequence(setMetadata('a', { rating: 5 }), addBin('Best', null, 'rating>=4', 'best'))(base());
    expect(names(binContents(p, 'best'))).toEqual(['A001_interview.mov']);
    expect(() => moveToBin(['b'], 'best')(p)).toThrow(/Smart bins/);
  });

  it('renames and removes unused media, and survives save and load', () => {
    let p = sequence(renameAsset('a', 'Interview'), insertItem('b', { trackId: 'v1' }), setMetadata('song', { comments: 'temp' }))(base());
    expect(p.assets.a.name).toBe('Interview');
    expect(() => removeAsset('b')(p)).toThrow(/used on a timeline/);
    p = removeAsset('song')(p);
    expect(p.assets.song).toBeUndefined();
    expect(p.media).toBeUndefined();
    expect(migrateProject(JSON.parse(JSON.stringify(moveToBin(['a'], 'day1')(p))))).toEqual(moveToBin(['a'], 'day1')(p));
  });
});
