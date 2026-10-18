import { describe, expect, it } from 'vitest';
import { MASTER, addBus, dbToGain, deleteStripKeyframe, mixOf, panGains, removeBus, routeOf, routeTrack, scaleMaster, setStrip, setStripEffect, setStripKeyframe, stripOf } from '../../src/core/mix';
import { migrateProject } from '../../src/core/migrate';
import { emptyProject } from '../../src/core/model';
import { removeTrack, sequence } from '../../src/core/operations';
import { StripBank } from '../../src/engine/audio/strips';

const RATE = 48000;
const ones = (frames: number) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)];

describe('mix model', () => {
  it('starts at unity and routes every track to the master', () => {
    const project = emptyProject();
    expect(routeOf(project, 'a1')).toMatchObject({ output: MASTER, strip: { volume: 0, pan: 0 } });
    expect(stripOf(project, 'nope')).toBeNull();
    expect(() => setStrip('nope', { volume: 1 })(project)).toThrow();
  });

  it('routes tracks through buses and back to the master when a bus goes away', () => {
    const project = sequence(addBus('Dialogue', 'bus1'), routeTrack('a1', 'bus1'), setStrip('bus1', { volume: -6 }))(emptyProject());
    expect(routeOf(project, 'a1').output).toBe('bus1');
    expect(stripOf(project, 'bus1')!.volume).toBe(-6);
    expect(() => routeTrack('a1', 'missing')(project)).toThrow();
    expect(() => addBus('Again', 'a1')(project)).toThrow();
    const removed = removeBus('bus1')(project);
    expect(routeOf(removed, 'a1').output).toBe(MASTER);
  });

  it('clamps values, keeps keyframes sorted and drops strips of removed tracks', () => {
    let project = sequence(
      setStrip('a1', { volume: 40, pan: -3 }),
      setStripKeyframe('a1', 'volume', 2, -10),
      setStripKeyframe('a1', 'volume', 1, 0),
      setStripEffect('a1', 'eq', { low: 3 }),
      setStripEffect('a1', 'eq', { mid: 2 }),
    )(emptyProject());
    const strip = stripOf(project, 'a1')!;
    expect(strip.volume).toBe(12);
    expect(strip.pan).toBe(-1);
    expect(strip.animations.volume.map((k) => k.t)).toEqual([1, 2]);
    expect(strip.effects).toHaveLength(1);
    expect(strip.effects[0].params).toEqual({ low: 3, mid: 2 });
    project = deleteStripKeyframe('a1', 'volume', null)(project);
    expect(stripOf(project, 'a1')!.animations.volume).toBeUndefined();
    project = removeTrack('a1')(project);
    expect(mixOf(project).tracks.a1).toBeUndefined();
  });

  it('offsets the master and survives a save', () => {
    const project = sequence(scaleMaster(-4.5), scaleMaster(-1), addBus('Music', 'bus2'))(emptyProject());
    expect(stripOf(project, MASTER)!.volume).toBeCloseTo(-5.5);
    expect(migrateProject(JSON.parse(JSON.stringify(project))).mix).toEqual(project.mix);
  });

  it('pans with a balance law', () => {
    expect(panGains(0)).toEqual([1, 1]);
    expect(panGains(-1)).toEqual([1, 0]);
    expect(panGains(0.5)).toEqual([0.5, 1]);
  });
});

describe('strip processing', () => {
  it('applies volume, pan, mute and effects', () => {
    const bank = new StripBank();
    const unity = stripOf(emptyProject(), MASTER)!;
    const a = ones(100);
    bank.process('s', { ...unity, volume: -6, pan: 0.5 }, a, 0, RATE);
    expect(a[0][0]).toBeCloseTo(dbToGain(-6) * 0.5, 6);
    expect(a[1][0]).toBeCloseTo(dbToGain(-6), 6);
    const muted = ones(10);
    bank.process('m', { ...unity, mute: true }, muted, 0, RATE);
    expect(muted[0][5]).toBe(0);
    const limited = ones(1000).map((c) => c.fill(2));
    bank.process('l', { ...unity, effects: [{ id: 'x', type: 'limiter', enabled: true, params: { ceiling: -6 } }] }, limited, 0, RATE);
    expect(Math.max(...limited[0])).toBeLessThanOrEqual(dbToGain(-6) + 1e-6);
  });

  it('follows volume automation in timeline time', () => {
    const bank = new StripBank();
    const strip = { ...stripOf(emptyProject(), MASTER)!, animations: { volume: [{ t: 1, v: 0 }, { t: 2, v: -60 }] } };
    const block = ones(RATE);
    bank.process('a', strip, block, 1, RATE);
    expect(block[0][0]).toBeCloseTo(1, 3);
    expect(block[0][RATE / 2]).toBeCloseTo(dbToGain(-30), 3);
    expect(block[0][RATE - 1]).toBeLessThan(0.002);
  });
});
