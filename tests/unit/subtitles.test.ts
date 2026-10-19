import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/core/migrate';
import { emptyProject, type Project } from '../../src/core/model';
import { addSubtitleTrack, addCue, parseSubtitles, removeCue, setCues, shiftCues, updateCue, updateSubtitleTrack, writeSrt, writeVtt } from '../../src/core/subtitles';
import { compositionAt, topLayersOf } from '../../src/core/timeline';
import { addTimeline, switchTimeline } from '../../src/core/timelines';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Two\r\nlines &amp; more\r\n\r\n';
const VTT = 'WEBVTT\n\nNOTE comment\n\nintro\n00:05.000 --> 00:06.250 align:start line:0\n<v Anna>Hi</v>\n';

const base = (): Project => ({ ...emptyProject(), settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000 } });

describe('subtitles', () => {
  it('parses SRT and WebVTT with tags, BOM and CRLF', () => {
    expect(parseSubtitles(SRT)).toEqual([{ start: 1, end: 2.5, text: 'Hello there' }, { start: 3, end: 4, text: 'Two\nlines & more' }]);
    expect(parseSubtitles(VTT)).toEqual([{ start: 5, end: 6.25, text: 'Hi' }]);
    expect(() => parseSubtitles('not subtitles')).toThrow(/No subtitles/);
  });

  it('writes SRT and VTT that read back the same', () => {
    const cues = parseSubtitles(SRT);
    expect(writeSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo\nlines & more\n');
    expect(parseSubtitles(writeSrt(cues))).toEqual(cues);
    expect(parseSubtitles(writeVtt(cues))).toEqual(cues);
  });

  it('edits cues and keeps them sorted and valid', () => {
    let p = addSubtitleTrack({ name: 'EN', cues: parseSubtitles(SRT) }, 's')(base());
    p = addCue('s', { start: 0.2, end: 0.8, text: 'First' }, 'c0')(p);
    expect(p.subtitles![0].cues.map((c) => c.text)).toEqual(['First', 'Hello there', 'Two\nlines & more']);
    p = updateCue('s', 'c0', { start: 5, end: 6 })(p);
    expect(p.subtitles![0].cues.at(-1)!.id).toBe('c0');
    expect(() => updateCue('s', 'c0', { end: 5.01 })(p)).toThrow(/at least/);
    p = shiftCues('s', -1.5)(p);
    expect(p.subtitles![0].cues.map((c) => [c.start, c.end])).toEqual([[0, 1], [1.5, 2.5], [3.5, 4.5]]);
    p = removeCue('s', 'c0')(p);
    p = setCues('s', [{ start: 1, end: 2, text: 'only' }])(p);
    expect(p.subtitles![0].cues.length).toBe(1);
    expect(() => updateSubtitleTrack('s', { style: { size: 2 } })(p)).toThrow(/size/);
  });

  it('burns subtitles into the picture only when asked', () => {
    let p = addSubtitleTrack({ cues: [{ start: 1, end: 2, text: 'Burn' }] }, 's')(base());
    expect(topLayersOf(compositionAt(p, 1.5)).length).toBe(0);
    p = updateSubtitleTrack('s', { burnIn: true, style: { position: 0.2, background: '#000000' } })(p);
    const [layer] = topLayersOf(compositionAt(p, 1.5));
    expect(layer.placement.item.kind === 'text' && layer.placement.item.text).toMatchObject({ content: 'Burn', bottom: 0.2, background: '#000000', outline: '#000000' });
    expect(topLayersOf(compositionAt(p, 2.5)).length).toBe(0);
    expect(compositionAt(p, 1.5).layers[0].base.placement.item).toBe(compositionAt(p, 1.7).layers[0].base.placement.item);
  });

  it('belongs to its timeline and survives save and load', () => {
    let p = addSubtitleTrack({ name: 'Main subs' }, 's')(base());
    p = addTimeline('Second', 'two')(p);
    p = switchTimeline('two')(p);
    expect(p.subtitles).toBeUndefined();
    p = switchTimeline('timeline_main')(p);
    expect(p.subtitles![0].name).toBe('Main subs');
    const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.subtitles).toEqual(p.subtitles);
  });
});
