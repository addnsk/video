import { describe, expect, it } from 'vitest';
import { createMontageApi } from '../../src/api/montage';
import { EditorSession } from '../../src/host/session';
import { FakeEngine, file } from './support/fake-engine';

const setup = async () => {
  const engine = new FakeEngine();
  const session = new EditorSession(engine);
  await session.importAndPlace([{ file: file('a.mov') }, { file: file('song.wav') }], () => undefined);
  return { engine, session, montage: createMontageApi(session) };
};

describe('mixer api', () => {
  it('sets levels, routes through buses and undoes', async () => {
    const { montage, session } = await setup();
    const bus = montage.mixer.addBus('Music');
    montage.mixer.route('a1', bus);
    montage.mixer.set('a1', { volume: -6, pan: 0.3, mute: true });
    montage.mixer.set(bus, { volume: -3, mute: true });
    montage.mixer.effect('master', 'limiter', { ceiling: -1 });
    montage.mixer.keyframe(bus, 'volume', 2, -12);
    const state = montage.mixer.state();
    const a1 = state.tracks.find((t) => t.id === 'a1')!;
    expect(a1).toMatchObject({ output: bus, volume: -6, pan: 0.3, mute: true });
    expect(montage.tracks().find((t) => t.id === 'a1')!.muted).toBe(true);
    expect(state.buses[0]).toMatchObject({ id: bus, name: 'Music', volume: -3, mute: true, automation: { volume: [{ t: 2, v: -12 }] } });
    expect(state.master.effects).toEqual([{ type: 'limiter', enabled: true, params: { ceiling: -1 } }]);
    session.store.undo();
    expect(montage.mixer.state().buses[0].automation).toEqual({});
  });

  it('routes buses into buses and sends tracks to buses', async () => {
    const { montage } = await setup();
    const verb = montage.mixer.addBus('Reverb');
    const group = montage.mixer.addBus('Group');
    montage.mixer.route(verb, group);
    montage.mixer.send('a1', verb, -8, { pre: true });
    const state = montage.mixer.state();
    expect(state.buses.find((b) => b.id === verb)!.output).toBe(group);
    expect(state.tracks.find((t) => t.id === 'a1')!.sends).toEqual([{ bus: verb, level: -8, pre: true }]);
    expect(() => montage.mixer.route(group, verb)).toThrow(/loop/);
    montage.mixer.removeBus(verb);
    expect(montage.mixer.state().tracks.find((t) => t.id === 'a1')!.sends).toEqual([]);
    montage.mixer.send('a1', group, null);
  });

  it('rejects unknown targets, effects and properties', async () => {
    const { montage } = await setup();
    expect(() => montage.mixer.set('zzz', { volume: 1 })).toThrow(/No track, bus or master/);
    expect(() => montage.mixer.effect('master', 'chorus', {})).toThrow(/Unknown audio effect/);
    expect(() => montage.mixer.keyframe('master', 'width', 0, 1)).toThrow(/volume, pan/);
    expect(() => montage.mixer.route('a1', 'nobus')).toThrow(/No bus/);
  });

  it('normalizes the master to a platform target and adds a limiter when peaks would clip', async () => {
    const { montage, engine } = await setup();
    const result = await montage.normalize('youtube');
    expect(result.gain).toBeCloseTo(6);
    expect(result.limiter).toBe(true);
    expect(montage.mixer.state().master).toMatchObject({ trim: 6, volume: 0, effects: [{ type: 'limiter', params: { ceiling: -1 } }] });
    engine.loudness = { ...engine.loudness, integrated: -10, peak: -12, truePeak: -12 };
    const quieter = await montage.normalize(-23);
    expect(quieter.gain).toBeCloseTo(-13);
    expect(montage.mixer.state().master.trim).toBeCloseTo(-7);
    await expect(montage.normalize('cinema' as never)).rejects.toThrow(/Unknown loudness target/);
    engine.loudness = { ...engine.loudness, integrated: -Infinity };
    await expect(montage.normalize()).rejects.toThrow(/silent/);
    expect(await montage.loudness()).toMatchObject({ integrated: -Infinity });
  });
});

describe('input color space per clip', () => {
  it('overrides one clip and falls back to the media setting when cleared', async () => {
    const engine = new FakeEngine();
    const session = new EditorSession(engine);
    await session.importAndPlace([{ file: file('a.mov') }], () => undefined);
    const montage = createMontageApi(session);
    const assetId = montage.clip(0).assetId!;
    montage.add(assetId);
    const [first, second] = montage.clips();
    montage.colorSpace({ asset: assetId }, 'slog3');
    expect(montage.colorSpace(1, 'logc3', { clip: true })).toBe('logc3');
    expect(montage.colorSpace(0)).toBe('slog3');
    expect(montage.colorSpace(second.id)).toBe('logc3');
    expect(montage.colorSpace(1, null, { clip: true })).toBe('slog3');
    expect(() => montage.colorSpace(first.id, 'nope', { clip: true })).toThrow(/Unknown color space/);
  });
});
