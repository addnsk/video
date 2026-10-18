import { describe, expect, it } from 'vitest';
import { createMontageApi, runScript } from '../../src/api/montage';
import { EditorSession } from '../../src/host/session';
import { FakeEngine, file, flush } from './support/fake-engine';

const setup = async (names = ['a.mov', 'b.mov']) => {
  const engine = new FakeEngine({ 'b.mov': 6 });
  const session = new EditorSession(engine);
  const errors: string[] = [];
  await session.importAndPlace(names.map((n) => ({ file: file(n) })), (f, e) => errors.push(`${f.name}: ${e.message}`));
  const montage = createMontageApi(session);
  return { engine, session, montage, errors };
};

describe('session import', () => {
  it('places video on the main track and audio on an audio track', async () => {
    const { montage } = await setup(['a.mov', 'song.wav', 'b.mov']);
    expect(montage.clips().map((c) => c.name)).toEqual(['a.mov', 'b.mov']);
    expect(montage.clips('a1').map((c) => c.name)).toEqual(['song.wav']);
    expect(montage.duration).toBe(16);
  });

  it('reports failures and keeps going', async () => {
    const { montage, errors } = await setup(['x.fail', 'a.mov']);
    expect(errors).toEqual(['x.fail: Unsupported x.fail']);
    expect(montage.clips()).toHaveLength(1);
  });

  it('tracks missing media and relinks', async () => {
    const { session, engine } = await setup(['a.mov']);
    const [meta] = Object.values(session.store.project.assets);
    session.files.clear();
    expect(session.missing).toEqual([meta.id]);
    const media: string[][] = [];
    session.on('media', ({ missing }) => media.push([...missing]));
    session.attachFile(meta, file('a.mov'));
    expect(media).toEqual([[]]);
    expect(engine.called('attach')).toHaveLength(1);
  });

  it('loads peaks and thumbnails once per asset', async () => {
    const { session, engine } = await setup(['a.mov', 'song.wav']);
    const [video, audio] = Object.values(session.store.project.assets);
    const ready: string[] = [];
    session.on('thumbnails', (id) => ready.push(id));
    expect(session.thumbnails(video.id)).toBeNull();
    expect(session.thumbnails(audio.id)).toBeNull();
    await flush();
    const strip = session.thumbnails(video.id)!;
    expect(strip.frames).toHaveLength(10);
    expect(strip.interval).toBe(1);
    expect(engine.called('thumbnails')[0].args[1]).toEqual(Array.from({ length: 10 }, (_, i) => i + 0.5));
    expect(ready).toEqual([video.id]);
    session.peaks(audio.id);
    session.peaks(audio.id);
    await flush();
    expect(session.peaks(audio.id)).toEqual(new Float32Array([0, 1]));
    expect(engine.called('peaks')).toHaveLength(1);
  });

  it('pushes every project change to the engine', async () => {
    const { engine, montage } = await setup();
    const before = engine.called('setProject').length;
    montage.volume(0, 0.5);
    expect(engine.called('setProject').length).toBe(before + 1);
  });
});

describe('montage api', () => {
  it('edits, splits and undoes', async () => {
    const { montage } = await setup();
    const right = montage.split(4);
    expect(right?.start).toBe(4);
    expect(montage.clips()).toHaveLength(3);
    montage.undo();
    expect(montage.clips()).toHaveLength(2);
    montage.trim(0, { in: 2 });
    expect(montage.clip(0).duration).toBe(8);
    montage.move(1, 0);
    expect(montage.clip(0).name).toBe('b.mov');
    montage.remove(0);
    expect(montage.clips()).toHaveLength(1);
  });

  it('applies grades with wheel merging and resets them', async () => {
    const { montage } = await setup();
    montage.grade('all', { exposure: 1, lift: { x: 0.1 } });
    montage.grade(0, { lift: { y: 0.2 } });
    const grade = montage.clip(0).effects.find((e) => e.type === 'grade')!;
    expect(grade.params.exposure).toBe(1);
    expect(grade.params.lift).toEqual([0.1, 0.2, 0]);
    expect(montage.clip(1).effects).toHaveLength(1);
    montage.resetGrade('all');
    await flush();
    expect(montage.clips().every((c) => c.effects.length === 0)).toBe(true);
  });

  it('validates transitions and effects', async () => {
    const { montage } = await setup();
    expect(() => montage.transition(1, { type: 'nope' })).toThrow(/Available: .*dissolve/);
    expect(() => montage.effect(0, 'nope', {})).toThrow('Unknown effect');
    montage.transition(1, { type: 'dissolve', duration: 0.5 });
    expect(montage.clip(1).transition).toMatchObject({ type: 'dissolve', duration: 0.5 });
  });

  it('registers custom filters and transitions and sends them to the engine', async () => {
    const { montage, engine } = await setup();
    montage.effects.register({ id: 'invert', name: 'Invert', glsl: 'vec4 effect(vec4 c, vec2 uv) { return vec4(1.0 - c.rgb, c.a); }' });
    montage.transitions.register({ id: 'flash', name: 'Flash', glsl: 'uniform float strength; // = 0.5\nvec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }' });
    expect(montage.effects.list().some((e) => e.id === 'invert')).toBe(true);
    expect(montage.transitions.list().some((e) => e.id === 'flash')).toBe(true);
    const sent = engine.called('setEffects').flatMap((c) => (c.args[0] as { id: string }[]).map((d) => d.id));
    expect(sent).toEqual(expect.arrayContaining(['invert', 'flash']));
    montage.effect(0, 'invert', {});
    expect(montage.clip(0).effects.map((e) => e.type)).toEqual(['invert']);
  });

  it('loads LUT text and references it from clips', async () => {
    const { montage, engine } = await setup();
    const cube = ['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`)].join('\n');
    const id = await montage.lut(0, cube, 0.7);
    expect(montage.clip(0).effects[0]).toEqual({ type: 'lut', params: { table: id, strength: 0.7 } });
    expect(engine.called('setLut')).toHaveLength(1);
  });

  it('builds multitrack titles with keyframes', async () => {
    const { montage } = await setup();
    const title = montage.title('Hello', { start: 1, duration: 2, size: 80 });
    expect(title.track).toBe('v2');
    montage.keyframe(title.id, 'opacity', 0, 0);
    montage.keyframe(title.id, 'opacity', 1, 1);
    expect(montage.clip(title.id).animations.opacity).toHaveLength(2);
    montage.removeKeyframe(title.id, 'opacity', 0);
    montage.clearKeyframes(title.id, 'opacity');
    expect(montage.clip(title.id).animations.opacity).toBeUndefined();
    const extra = montage.addTrack('video');
    montage.place(title.id, extra, 3);
    expect(montage.clip(title.id)).toMatchObject({ track: extra, start: 3 });
    montage.muteTrack(extra);
    expect(montage.tracks().find((t) => t.id === extra)?.muted).toBe(true);
  });

  it('throws on unknown clips', async () => {
    const { montage } = await setup();
    expect(() => montage.clip(9)).toThrow('No clip 9');
    expect(() => montage.clips('zz')).toThrow('No track zz');
  });

  it('renders through the engine', async () => {
    const { montage, engine } = await setup();
    const result = await montage.render({ height: 720 });
    expect(result.file?.name).toBe('out.mp4');
    expect(result.savedToDisk).toBe(false);
    const [, settings, target] = engine.called('exportVideo')[0].args;
    expect(settings).toEqual({ height: 720, quality: 'high' });
    expect(target).toMatchObject({ kind: 'storage' });
  });

  it('forwards proxy and export progress events', async () => {
    const { session, engine } = await setup();
    const states: string[] = [];
    session.on('proxy', ({ state }) => states.push(state));
    engine.events.emit('progress', { task: 'proxy', id: 'x', fraction: 0.5 });
    engine.events.emit('proxy', { assetId: 'x', state: 'ready' });
    expect(states).toEqual(['building', 'ready']);
    expect(session.proxies.get('x')).toEqual({ state: 'ready', fraction: 1 });
  });
});

describe('runScript', () => {
  it('runs a script as one undo step and returns its value', async () => {
    const { montage } = await setup();
    const logs: unknown[] = [];
    const value = await runScript("montage.volume('all', 0.2); montage.split(3); log('done'); return montage.clips().length;", montage, (...a) => logs.push(...a));
    expect(value).toBe(3);
    expect(logs).toEqual(['done']);
    montage.undo();
    expect(montage.clips()).toHaveLength(2);
    expect(montage.clip(0).volume).toBe(1);
  });

  it('surfaces syntax errors', async () => {
    const { montage } = await setup();
    await expect(runScript('this is not js', montage, () => undefined)).rejects.toBeInstanceOf(SyntaxError);
  });
});
