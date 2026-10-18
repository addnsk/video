import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/emitter';
import { connect, localChannel, RemoteError, serve, transfer } from '../../src/core/rpc';

interface Api {
  add(a: number, b: number): number;
  slow(ms: number): Promise<string>;
  fail(): void;
  wrapped(): ReturnType<typeof transfer<{ n: number }>>;
}

interface Events extends Record<string, unknown> {
  tick: number;
}

const setup = () => {
  const [a, b] = localChannel();
  const emitter = new Emitter<Events>();
  const methods: Api = {
    add: (x, y) => x + y,
    slow: (ms) => new Promise((r) => setTimeout(() => r(`waited ${ms}`), ms)),
    fail: () => {
      throw new TypeError('boom');
    },
    wrapped: () => transfer({ n: 7 }, []),
  };
  serve(a, methods, emitter, ['tick']);
  return { ...connect<Api, Events>(b), emitter };
};

describe('rpc over localChannel', () => {
  it('resolves calls', async () => {
    const { remote } = setup();
    expect(await remote.add(2, 3)).toBe(5);
  });

  it('keeps concurrent calls apart', async () => {
    const { remote } = setup();
    const [slow, fast] = await Promise.all([remote.slow(20), remote.add(1, 1)]);
    expect(slow).toBe('waited 20');
    expect(fast).toBe(2);
  });

  it('rejects with remote error name and message', async () => {
    const { remote } = setup();
    const error = await remote.fail().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as Error).name).toBe('TypeError');
    expect((error as Error).message).toBe('boom');
  });

  it('rejects unknown methods', async () => {
    const { remote } = setup();
    const missing = (remote as unknown as Record<string, () => Promise<unknown>>).nope;
    await expect(missing()).rejects.toThrow('Unknown method nope');
  });

  it('unwraps transfer results', async () => {
    const { remote } = setup();
    expect(await remote.wrapped()).toEqual({ n: 7 });
  });

  it('forwards events', async () => {
    const { events, emitter } = setup();
    const seen: number[] = [];
    events.on('tick', (v) => seen.push(v));
    emitter.emit('tick', 1);
    emitter.emit('tick', 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([1, 2]);
  });
});
