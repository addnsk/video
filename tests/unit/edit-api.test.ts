import { describe, expect, it } from 'vitest';
import { createMontageApi } from '../../src/api/montage';
import { resolveThreePoint } from '../../src/core/three-point';
import { EditorSession } from '../../src/host/session';
import { FakeEngine, file } from './support/fake-engine';

const setup = async () => {
  const engine = new FakeEngine({ 'b.mov': 6 });
  const session = new EditorSession(engine);
  await session.importAndPlace([{ file: file('a.mov') }], () => undefined);
  const b = await session.importFile(file('b.mov'));
  const montage = createMontageApi(session);
  return { engine, session, montage, b: b.id };
};

describe('three-point resolution', () => {
  const source = { playhead: 1, start: 0, end: 10 };
  it('uses source in and out with the timeline playhead', () => {
    expect(resolveThreePoint({ source: { ...source, in: 2, out: 5 }, record: { playhead: 7 } })).toEqual({ sourceIn: 2, sourceOut: 5, recordIn: 7, speed: 1 });
  });
  it('fills a timeline range from the source in', () => {
    expect(resolveThreePoint({ source: { ...source, in: 2 }, record: { in: 3, out: 4.5, playhead: 0 } })).toEqual({ sourceIn: 2, sourceOut: 3.5, recordIn: 3, speed: 1 });
  });
  it('backtimes from the source out', () => {
    expect(resolveThreePoint({ source: { ...source, out: 6 }, record: { in: 3, out: 5, playhead: 0 } })).toEqual({ sourceIn: 4, sourceOut: 6, recordIn: 3, speed: 1 });
  });
  it('backtimes from the timeline out', () => {
    expect(resolveThreePoint({ source: { ...source, in: 2, out: 4 }, record: { out: 9, playhead: 0 } })).toEqual({ sourceIn: 2, sourceOut: 4, recordIn: 7, speed: 1 });
  });
  it('fits to fill with four points', () => {
    expect(resolveThreePoint({ source: { ...source, in: 2, out: 6 }, record: { in: 0, out: 2, playhead: 0 } }).speed).toBe(2);
    expect(() => resolveThreePoint({ source: { ...source, in: 0, out: 10 }, record: { in: 0, out: 0.1, playhead: 0 } })).toThrow(/Fit to fill/);
  });
  it('defaults to playhead to end of clip', () => {
    expect(resolveThreePoint({ source, record: { playhead: 2 } })).toEqual({ sourceIn: 1, sourceOut: 10, recordIn: 2, speed: 1 });
  });
});

describe('edit api', () => {
  it('inserts linked video and audio from the source viewer marks', async () => {
    const { montage, engine, b } = await setup();
    montage.source.open(b);
    expect(engine.called('setSource').at(-1)!.args[0]).toMatchObject({ tracks: [{ items: [{ id: 'source' }] }, { items: [] }] });
    montage.source.mark({ in: 1, out: 3 });
    montage.seek(4);
    const result = montage.edit.insert();
    expect(result).toMatchObject({ start: 4, duration: 2 });
    const main = montage.clips();
    expect(main.map((c) => [c.name, c.start, c.duration, c.audio])).toEqual([['a.mov', 0, 4, true], ['b.mov', 4, 2, false], ['a.mov', 6, 6, true]]);
    const audio = montage.clips('a1');
    expect(audio.map((c) => [c.name, c.start, c.in])).toEqual([['b.mov', 4, 1]]);
    expect(montage.edit.linked(result.video!)).toEqual([result.video, result.audio]);
    montage.undo();
    expect(montage.clips()).toHaveLength(1);
  });

  it('overwrites into timeline marks and fits to fill', async () => {
    const { montage, b } = await setup();
    montage.marks({ in: 2, out: 3 });
    montage.edit.overwrite({ asset: b, in: 0, out: 2, audio: null });
    expect(montage.clips().map((c) => [c.name, c.start, c.duration, c.speed])).toEqual([['a.mov', 0, 2, 1], ['b.mov', 2, 1, 2], ['a.mov', 3, 7, 1]]);
  });

  it('appends at the end of the target tracks', async () => {
    const { montage, b } = await setup();
    const r = montage.edit.append({ asset: b, in: 0, out: 1 });
    expect(r.start).toBe(10);
    expect(montage.clips('a1')[0].start).toBe(10);
  });

  it('trims, slips, rolls and deletes through the api with linked clips following', async () => {
    const { montage, b } = await setup();
    const first = montage.edit.append({ asset: b, in: 0, out: 3 });
    montage.edit.ripple(first.video!, 'out', -1);
    expect(montage.clip(first.audio!).duration).toBe(2);
    montage.edit.slip(first.video!, 1);
    expect(montage.clip(first.audio!).in).toBe(1);
    montage.edit.unlink(first.video!);
    montage.edit.slip(first.video!, 1);
    expect(montage.clip(first.audio!).in).toBe(1);
    montage.edit.link([first.video!, first.audio!]);
    montage.edit.delete(first.video!, { ripple: true });
    expect(montage.clips('a1')).toHaveLength(0);
    expect(() => montage.edit.ripple(0, 'middle' as never, 1)).toThrow(/Edge/);
  });

  it('lifts and extracts the marked range and keeps markers in step', async () => {
    const { montage } = await setup();
    const id = montage.markers.add({ time: 8, name: 'end', color: 'red' });
    montage.markers.add({ time: 1 });
    montage.marks({ in: 2, out: 5 });
    montage.edit.extract();
    expect(montage.duration).toBe(7);
    expect(montage.markers.list().find((m) => m.id === id)!.time).toBe(5);
    expect(montage.markers.next(1)!.id).toBe(id);
    expect(montage.markers.previous(5)!.time).toBe(1);
    montage.edit.lift(0, 1);
    expect(montage.clip(0).start).toBe(1);
    montage.markers.update(id, { note: 'ok' });
    expect(() => montage.markers.update('nope', {})).toThrow(/No marker/);
  });

  it('switches the viewer and keeps marks per clip', async () => {
    const { montage, session, engine, b } = await setup();
    const a = montage.assets()[0].id;
    montage.source.open(b);
    montage.source.mark({ in: 2 });
    montage.source.open(a);
    expect(montage.source.state().marks).toEqual({});
    montage.source.open(b);
    expect(montage.source.state().marks).toEqual({ in: 2 });
    montage.source.show('timeline');
    expect(engine.called('setSource').at(-1)!.args[0]).toBeNull();
    expect(session.source.viewer).toBe('timeline');
    montage.source.close();
    expect(() => montage.edit.insert()).toThrow(/source viewer/);
  });
});
