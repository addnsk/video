import { Emitter } from './emitter';

export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
}

type Message =
  | { kind: 'call'; id: number; method: string; args: unknown[] }
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string; name: string }
  | { kind: 'event'; name: string; value: unknown };

const TRANSFER = Symbol('transfer');

export interface Transfer<T> {
  readonly [TRANSFER]: true;
  readonly value: T;
  readonly list: Transferable[];
}

export const transfer = <T>(value: T, list: Transferable[]): Transfer<T> => ({ [TRANSFER]: true, value, list });

const isTransfer = (v: unknown): v is Transfer<unknown> => typeof v === 'object' && v !== null && TRANSFER in v;

type Unwrap<T> = T extends Transfer<infer U> ? U : T;

export type Methods = object;

export type Remote<M extends Methods> = {
  [K in keyof M]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Unwrap<Awaited<R>>> : never;
};

export class RemoteError extends Error {}

export function serve<M extends Methods, E extends Record<string, unknown>>(port: Port, methods: M, events: Emitter<E>, eventNames: (keyof E & string)[]): void {
  port.addEventListener('message', async (event) => {
    const message = event.data as Message;
    if (message.kind !== 'call') return;
    try {
      const fn = (methods as Record<string, unknown>)[message.method] as ((...a: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Unknown method ${message.method}`);
      const result = await fn(...message.args);
      if (isTransfer(result)) port.postMessage({ kind: 'result', id: message.id, value: result.value } satisfies Message, result.list);
      else port.postMessage({ kind: 'result', id: message.id, value: result } satisfies Message);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      port.postMessage({ kind: 'error', id: message.id, message: error.message, name: error.name } satisfies Message);
    }
  });
  for (const name of eventNames) {
    events.on(name, (value) => {
      if (isTransfer(value)) port.postMessage({ kind: 'event', name, value: value.value } satisfies Message, value.list);
      else port.postMessage({ kind: 'event', name, value } satisfies Message);
    });
  }
  port.start?.();
}

export function connect<M extends Methods, E extends Record<string, unknown>>(port: Port): { remote: Remote<M>; events: Emitter<E> } {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const events = new Emitter<E>();
  let next = 1;
  port.addEventListener('message', (event) => {
    const message = event.data as Message;
    if (message.kind === 'event') {
      events.emit(message.name as keyof E, message.value as E[keyof E]);
      return;
    }
    if (message.kind === 'call') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.kind === 'result') entry.resolve(message.value);
    else {
      const error = new RemoteError(message.message);
      error.name = message.name;
      entry.reject(error);
    }
  });
  port.start?.();
  const remote = new Proxy({} as Remote<M>, {
    get(_, method: string) {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = next++;
          pending.set(id, { resolve, reject });
          const list: Transferable[] = [];
          const plain = args.map((a) => {
            if (!isTransfer(a)) return a;
            list.push(...a.list);
            return a.value;
          });
          port.postMessage({ kind: 'call', id, method, args: plain } satisfies Message, list);
        });
    },
  });
  return { remote, events };
}

class LocalPort implements Port {
  peer: LocalPort | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();

  postMessage(message: unknown): void {
    const peer = this.peer;
    if (!peer) return;
    queueMicrotask(() => {
      for (const listener of peer.listeners) listener({ data: message } as MessageEvent);
    });
  }

  addEventListener(_: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
}

export function localChannel(): [Port, Port] {
  const a = new LocalPort();
  const b = new LocalPort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
