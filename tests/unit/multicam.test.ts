import { describe, expect, it } from 'vitest';
import { emptyProject, type MediaItem, type Project } from '../../src/core/model';
import { createMulticam, multicamOf, multiviewProject, setAngle, switchAngle } from '../../src/core/multicam';
import { addAsset, insertItem, sequence } from '../../src/core/operations';
import { allLayersOf, audibleAt, compositionAt } from '../../src/core/timeline';
import { nestedProject } from '../../src/core/timeline-data';
import { nestedAssetId } from '../../src/core/timelines';
import { asset } from './fixtures';

const base = () =>
  sequence(
    addAsset({ ...asset('camA', 20), name: 'A.mov' }),
    addAsset({ ...asset('camB', 20), name: 'B.mov' }),
    addAsset({ ...asset('camC', 20), name: 'C.mov', hasAudio: false }),
    createMulticam('Interview', [{ assetId: 'camA' }, { assetId: 'camB', offset: 2 }, { assetId: 'camC', offset: -1 }], 'mc'),
    insertItem(nestedAssetId('mc'), { trackId: 'v1', id: 'cut' }),
  )({ ...emptyProject(), settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000 } });

const visible = (p: Project, t: number) => allLayersOf(compositionAt(p, t)).filter((l) => !l.nested).map((l) => p.assets[(l.placement.item as MediaItem).source.assetId]?.name);
const media = (p: Project, id: string) => p.tracks[0].items.find((i) => i.id === id) as MediaItem;

describe('multicam', () => {
  it('lines up the angles by offset and shows one angle at a time', () => {
    const p = base();
    expect(p.assets[nestedAssetId('mc')].end).toBe(23);
    expect(multicamOf(p, media(p, 'cut'))!.angles.map((a) => a.name)).toEqual(['A.mov', 'B.mov', 'C.mov']);
    expect(visible(p, 5)).toEqual(['A.mov']);
    const b = setAngle('cut', { video: 1 })(p);
    expect(visible(b, 5)).toEqual(['B.mov']);
    expect(visible(b, 2)).toEqual([]);
    expect(compositionAt(setAngle('cut', { video: 2 })(p), 0).layers[0].base.nested!.layers[0].base.sourceTime).toBeCloseTo(0);
  });

  it('plays the audio angle, which follows the picture unless set', () => {
    const p = setAngle('cut', { video: 1 })(base());
    const audioOf = (q: Project) => {
      const inner = nestedProject(q, media(q, 'cut'))!;
      return audibleAt(inner, 5, 6).filter((x) => x.track.kind === 'audio').map((x) => q.assets[(x.item as MediaItem).source.assetId].name);
    };
    expect(audioOf(p)).toEqual(['B.mov']);
    expect(audioOf(setAngle('cut', { audio: 0 })(p))).toEqual(['A.mov']);
    expect(audioOf(setAngle('cut', { video: 2, audio: null })(p))).toEqual([]);
    expect(() => setAngle('cut', { video: 3 })(p)).toThrow(/Angle must be 0–2/);
  });

  it('cuts to another angle at the playhead', () => {
    let p = switchAngle(6, 'v1', { video: 1 })(base());
    expect(p.tracks[0].items.map((i) => (i as MediaItem).angle)).toEqual([undefined, 1]);
    p = switchAngle(10, 'v1', { video: 0, audio: 1 })(p);
    expect(p.tracks[0].items.map((i) => [(i as MediaItem).angle, (i as MediaItem).audioAngle])).toEqual([[undefined, undefined], [1, undefined], [0, 1]]);
    expect(visible(p, 7)).toEqual(['B.mov']);
    expect(visible(p, 11)).toEqual(['A.mov']);
    const sameStart = switchAngle(0, 'v1', { video: 2 })(base());
    expect(sameStart.tracks[0].items).toHaveLength(1);
    expect(() => switchAngle(100, 'v1', { video: 1 })(base())).toThrow(/No multicam clip/);
  });

  it('builds a multiview grid of every angle', () => {
    const view = multiviewProject(base(), nestedAssetId('mc'));
    const frame = compositionAt(view, 5);
    const pictures = frame.layers.filter((l) => l.base.placement.item.kind === 'media').map((l) => [l.base.placement.item.transform.x, l.base.placement.item.transform.y, l.base.placement.item.transform.scale]);
    expect(pictures).toEqual([[-0.25, -0.25, 0.5], [0.25, -0.25, 0.5], [-0.25, 0.25, 0.5]]);
    expect(frame.layers.filter((l) => l.base.placement.item.kind === 'text')).toHaveLength(3);
  });

  it('refuses audio-only angles and single angles', () => {
    const p = addAsset({ ...asset('wav', 5), hasVideo: false })(base());
    expect(() => createMulticam('x', [{ assetId: 'camA' }, { assetId: 'wav' }])(p)).toThrow(/no picture/);
    expect(() => createMulticam('x', [{ assetId: 'camA' }])(p)).toThrow(/at least two/);
  });
});
