import { describe, expect, it } from 'vitest';
import { createMontageApi } from '../../src/api/montage';
import { EditorSession } from '../../src/host/session';
import { FakeEngine, file } from './support/fake-engine';

const setup = async () => {
  const engine = new FakeEngine();
  const session = new EditorSession(engine);
  await session.importAndPlace([{ file: file('a.mov') }], () => undefined);
  return { engine, session, montage: createMontageApi(session) };
};

describe('render queue', () => {
  it('renders every timeline and output in order with its own settings', async () => {
    const { engine, montage } = await setup();
    const main = montage.timelines.active().id;
    const other = montage.timelines.create('Teaser', { open: false });
    const jobs = montage.queue.outputs([main, other], ['master', 'web720']);
    expect(jobs.map((j) => j.name)).toEqual(['Timeline 1 ProRes 422 HQ.mov', 'Timeline 1 MP4 720p.mp4', 'Teaser ProRes 422 HQ.mov', 'Teaser MP4 720p.mp4']);
    const done = await montage.queue.start();
    expect(done.every((j) => j.status === 'done' && j.size === 4)).toBe(true);
    const exports = engine.calls.filter((c) => c.method === 'exportVideo').map((c) => c.args);
    expect(exports.map(([, s]) => [(s as { timeline: string }).timeline, (s as { prores: string | null }).prores])).toEqual([[main, 'hq'], [main, null], [other, 'hq'], [other, null]]);
    expect(exports.map(([, , target]) => (target as { clear: boolean }).clear)).toEqual([true, false, false, false]);
  });

  it('keeps going after a failure and can retry it', async () => {
    const { engine, montage } = await setup();
    let calls = 0;
    engine.handlers.exportVideo = () => {
      if (calls++ === 0) throw new Error('disk full');
      return new File([new Uint8Array(2)], 'x');
    };
    montage.queue.add({ preset: 'web1080' });
    montage.queue.add({ preset: 'review', name: 'Client' });
    const [first, second] = await montage.queue.start();
    expect(first.status).toBe('failed');
    expect(first.error).toMatch(/disk full/);
    expect(second.status).toBe('done');
    expect(second.name).toBe('Client.mp4');
    montage.queue.retry(first.id);
    expect((await montage.queue.start())[0].status).toBe('done');
    montage.queue.clearFinished();
    expect(montage.queue.list()).toEqual([]);
  });

  it('refuses unknown timelines and presets', async () => {
    const { montage } = await setup();
    expect(() => montage.queue.add({ timeline: 'nope' })).toThrow(/Unknown timeline/);
    expect(() => montage.queue.add({ preset: 'nope' })).toThrow(/Unknown render preset/);
  });
});
