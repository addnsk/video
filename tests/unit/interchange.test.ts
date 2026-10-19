import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addMarker } from '../../src/core/editing';
import { exchangeFromProject, exportInterchange, importExchange, readInterchange, type Exchange, type InterchangeFormat } from '../../src/core/interchange';
import { readEdl } from '../../src/core/interchange/edl';
import { readFcpxml } from '../../src/core/interchange/fcpxml';
import { parseXml } from '../../src/core/interchange/xml';
import { emptyProject, type Project } from '../../src/core/model';
import { addAsset, insertItem, insertText, sequence, setItemProps, setSpeed, setTransition, setVolume } from '../../src/core/operations';
import { activeTimeline, addTimeline, ensureNestedAsset, nestedAssetId, switchTimeline, timelineList } from '../../src/core/timelines';
import { asset } from './fixtures';

const music = { ...asset('music', 30), name: 'music.wav', hasVideo: false, width: 0, height: 0 };

export const buildSample = (): Project => {
  let p = sequence(
    addAsset(asset('a', 10)),
    addAsset(asset('b', 8)),
    addAsset(music),
  )({ ...emptyProject(), settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000 } });
  p = sequence(
    addTimeline('Inner', 'inner'),
    switchTimeline('inner'),
    insertItem('b', { trackId: 'v1', in: 1, out: 3, id: 'n1' }),
    switchTimeline('timeline_main'),
    ensureNestedAsset('inner'),
    insertItem('a', { trackId: 'v1', in: 0, out: 2, id: 'one' }),
    insertItem('b', { trackId: 'v1', in: 2, out: 4, id: 'two' }),
    setTransition('two', { type: 'dissolve', duration: 0.48, params: {} }),
    insertItem('a', { trackId: 'v1', in: 4, out: 6, id: 'three' }),
    setSpeed('three', 2),
    insertItem(nestedAssetId('inner'), { trackId: 'v1', in: 0, out: 2, id: 'nest' }),
    insertText('v2', 1, 1.2, { content: 'Hello' }, 'title'),
    insertItem('music', { trackId: 'a1', start: 0.4, in: 3, out: 6, id: 'song' }),
    addMarker({ time: 1.6, name: 'Cue', note: 'look', color: 'green' }),
    setItemProps('title', { transform: { x: 0.25, y: -0.1, scale: 0.5, rotation: 10 }, opacity: 0.6 }),
    setVolume('song', 0.5),
  )(p);
  return p;
};

const shape = (exchange: Exchange, keepText = true) => {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const clipName = (c: Exchange['main']['tracks'][number]['clips'][number]) => (c.sequence ? `seq:${exchange.sequences[c.sequence]?.name.replace(/ \d+$/, '')}` : c.media ? exchange.media[c.media]?.name : `text:${c.text}`);
  return exchange.main.tracks
    .map((t) => ({ kind: t.kind, clips: t.clips.filter((c) => keepText || c.text === undefined || c.media || c.sequence).map((c) => [clipName(c), round(c.start), round(c.duration), round(c.in), c.speed, round(c.transition), c.adjust ? Object.values(c.adjust).map(round) : null]) }))
    .filter((t) => t.clips.length);
};

const roundTrip = (format: InterchangeFormat, project: Project) => {
  const text = exportInterchange(project, format);
  const exchange = readInterchange(text, { format, fps: 25, width: 1920, height: 1080 });
  const { operation, result } = importExchange(exchange);
  const imported = operation(project);
  return { text, exchange, imported, result: result() };
};

describe('interchange', () => {
  for (const format of ['otio', 'fcpxml'] as const) {
    it(`${format}: a timeline survives export and import`, () => {
      const project = buildSample();
      const before = exchangeFromProject(project);
      const { imported, result } = roundTrip(format, project);
      expect(result.placeholders).toEqual([]);
      expect(activeTimeline(imported).id).toBe(result.timeline);
      const after = exchangeFromProject(imported);
      expect(shape(after)).toEqual(shape(before));
      expect(after.main.markers.map((m) => [m.time, m.name, m.note])).toEqual([[1.6, 'Cue', 'look']]);
      expect(timelineList(imported).length).toBe(timelineList(project).length + 2);
      expect(imported.tracks.find((t) => t.magnetic)!.items.every((i) => i.kind !== 'media' || !i.videoOnly)).toBe(true);
      expect(imported.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.items).length).toBe(1);
    });
  }

  it('fcpxml: writes a document Resolve and Final Cut understand', () => {
    const xml = exportInterchange(buildSample(), 'fcpxml');
    const root = parseXml(xml);
    expect(root.attrs.version).toBe('1.10');
    expect(xml).toContain('<transition name="Cross Dissolve"');
    expect(xml).toContain('<timeMap>');
    expect(xml).toContain('<ref-clip');
    expect(xml).toMatch(/<asset-clip ref="r\d+" name="music.wav" lane="-2"/);
    expect(xml).toContain('frameDuration="1/25s"');
  });

  it('otio: writes valid schema objects with ratios and dissolves', () => {
    const json = JSON.parse(exportInterchange(buildSample(), 'otio'));
    expect(json.OTIO_SCHEMA).toBe('Timeline.1');
    const v1 = json.tracks.children[0];
    expect(v1.children.map((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA)).toEqual(['Clip.2', 'Transition.1', 'Clip.2', 'Clip.2', 'Stack.1']);
    expect(v1.children[1].in_offset.value).toBeCloseTo(6);
    expect(v1.children[3].effects[0].time_scalar).toBe(2);
  });

  it('edl: keeps cuts, dissolves, speed and audio of one video track', () => {
    const project = buildSample();
    const { text, imported, result } = roundTrip('edl', project);
    expect(text).toMatch(/^TITLE: Timeline 1\nFCM: NON-DROP FRAME/);
    expect(text).toMatch(/002  AX\s+V\s+D\s+012 00:00:02:00/);
    expect(text).toContain('M2   AX       0050.0');
    const after = shape(exchangeFromProject(imported), false);
    const before = shape(exchangeFromProject(project), false);
    expect(after[0]).toEqual({ ...before[0], clips: before[0].clips.map((c) => (String(c[0]).startsWith('seq:') ? ['Inner', ...c.slice(1)] : c)) });
    expect(result.placeholders.length).toBe(1);
    expect(imported.assets[result.placeholders[0]].placeholder).toBe(true);
  });

  it('edl: reads a Resolve style list with a reel, a dissolve and a stereo pair', () => {
    const edl = `TITLE: Cut 3
FCM: NON-DROP FRAME

001  AX       AA/V  C        00:00:10:00 00:00:12:00 01:00:00:00 01:00:02:00
* FROM CLIP NAME: A001.mov

002  AX       V     C        00:00:12:00 00:00:12:00 01:00:02:00 01:00:02:00
002  AX       V     D    010 00:00:05:00 00:00:07:00 01:00:02:00 01:00:04:00
* FROM CLIP NAME: A001.mov
* TO CLIP NAME: B002.mov
`;
    const exchange = readEdl(edl, { fps: 25, width: 1920, height: 1080 });
    expect(exchange.main.name).toBe('Cut 3');
    const [v, a1, a2] = exchange.main.tracks;
    expect(v.clips.map((c) => [exchange.media[c.media!].name, c.start, c.duration, c.in, c.transition])).toEqual([['A001.mov', 0, 2.4, 10, 0], ['B002.mov', 2, 2, 5, 0.4]]);
    expect([a1.name, a2.name, a1.clips.length]).toEqual(['A1', 'A2', 1]);
  });

  it('fcpxml: reads connected clips, secondary storylines and compound clips from other apps', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE fcpxml><fcpxml version="1.9"><resources>
<format id="f" frameDuration="100/2500s" width="1280" height="720"/>
<asset id="a" name="shot" start="0s" duration="20s" hasVideo="1" hasAudio="1" format="f"><media-rep kind="original-media" src="file:///Volumes/Media/shot.mov"/></asset>
<media id="m" name="Compound"><sequence format="f"><spine><asset-clip ref="a" offset="0s" start="5s" duration="1s"/></spine></sequence></media>
</resources><library><event name="E"><project name="Edit &amp; Co"><sequence format="f"><spine>
<gap offset="0s" start="3600s" duration="2s"><asset-clip ref="a" lane="1" offset="3601s" start="10s" duration="1s" srcEnable="video"/></gap>
<asset-clip ref="a" offset="2s" start="2s" duration="3s"><spine lane="-1" offset="3s"><asset-clip ref="a" offset="0s" start="8s" duration="1s" srcEnable="audio"/></spine><marker start="3s" duration="1/25s" value="Hit"/></asset-clip>
<ref-clip ref="m" offset="5s" start="0s" duration="1s"/>
</spine></sequence></project></event></library></fcpxml>`;
    const exchange = readFcpxml(xml);
    expect(exchange.main.name).toBe('Edit & Co');
    expect([exchange.main.width, exchange.main.fps]).toEqual([1280, 25]);
    const video = exchange.main.tracks.filter((t) => t.kind === 'video');
    expect(video[0].clips.map((c) => [c.start, c.in, c.sequence ?? c.media])).toEqual([[2, 2, 'a'], [5, 0, 'm']]);
    expect(video[1].clips.map((c) => [c.start, c.in])).toEqual([[1, 10]]);
    const audio = exchange.main.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips.map((c) => [c.start, c.in]));
    expect(audio).toContainEqual([3, 8]);
    expect(exchange.main.markers.map((m) => [m.time, m.name])).toEqual([[3, 'Hit']]);
    expect(exchange.media.a.path).toBe('file:///Volumes/Media/shot.mov');
    const { operation, result } = importExchange(exchange);
    const imported = operation(buildSample());
    expect(imported.assets[result().placeholders[0]].name).toBe('shot.mov');
  });

  it('matches media already in the project by file name', () => {
    const project = buildSample();
    const otio = exportInterchange(project, 'otio');
    const { result } = (() => {
      const r = importExchange(readInterchange(otio, { fps: 25, width: 1920, height: 1080 }));
      r.operation(project);
      return r;
    })();
    expect(new Set(result().matched)).toEqual(new Set(['a', 'b', 'music']));
  });

  it('reads files written by the OpenTimelineIO reference adapters', () => {
    const read = (name: string) => {
      const x = readInterchange(readFileSync(new URL(`./interchange-fixtures/${name}`, import.meta.url), 'utf8'), { fileName: name, fps: 25, width: 1920, height: 1080 });
      return x.main.tracks.filter((t) => t.kind === 'video')[0].clips.map((c) => [c.name, +c.start.toFixed(3), +c.duration.toFixed(3), +c.in.toFixed(3), c.speed, +c.transition.toFixed(3)]);
    };
    const cut = [['a.mov', 0, 2, 0, 1, 0], ['b.mov', 1.52, 2, 2, 1, 0.48], ['a.mov', 3.52, 1, 4, 2, 0]];
    expect(read('ref.otio')).toEqual([...cut, ['Inner', 4.52, 2, 0, 1, 0]]);
    expect(read('ref.edl')).toEqual(cut);
    expect(read('ref.fcpxml')).toEqual([['a.mov', 0, 1.52, 0, 1, 0], ['b.mov', 1.52, 2, 2, 1, 0], ['a.mov', 3.52, 1, 4, 1, 0]]);
  });
});
