import { ProresFrameEncoder, type ColorTags, type Planes422 } from './encoder';
import { loadNativeCoder } from './native-coder';
import type { ProresProfile } from './tables';

type Reply = { id: number; data: Uint8Array } | { id: number; error: string };

export interface FrameEncoder {
  encode(planes: Planes422): Promise<Uint8Array>;
  close(): void;
}

class InlineEncoder implements FrameEncoder {
  private encoder: Promise<ProresFrameEncoder>;

  constructor(profile: ProresProfile, colors: ColorTags) {
    this.encoder = loadNativeCoder().then((coder) => new ProresFrameEncoder(profile, colors, coder ?? undefined));
  }

  async encode(planes: Planes422): Promise<Uint8Array> {
    return (await this.encoder).encode(planes);
  }

  close(): void {}
}

class WorkerPool implements FrameEncoder {
  private workers: Worker[];
  private idle: Worker[];
  private waiting: (() => void)[] = [];
  private pending = new Map<number, { resolve: (data: Uint8Array) => void; reject: (e: Error) => void }>();
  private next = 1;

  constructor(
    private profile: ProresProfile,
    private colors: ColorTags,
    size: number,
  ) {
    this.workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'prores' });
      worker.addEventListener('message', (event: MessageEvent<Reply>) => this.settle(worker, event.data));
      worker.addEventListener('error', (event) => this.fail(new Error(event.message || 'ProRes worker failed')));
      return worker;
    });
    this.idle = [...this.workers];
  }

  async encode(planes: Planes422): Promise<Uint8Array> {
    while (!this.idle.length) await new Promise<void>((r) => this.waiting.push(r));
    const worker = this.idle.pop()!;
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, profile: this.profile, colors: this.colors, planes }, [planes.y.buffer, planes.cb.buffer, planes.cr.buffer]);
    });
  }

  close(): void {
    for (const worker of this.workers) worker.terminate();
    this.fail(new Error('Encoder closed'));
  }

  private settle(worker: Worker, reply: Reply) {
    this.idle.push(worker);
    this.waiting.shift()?.();
    const entry = this.pending.get(reply.id);
    this.pending.delete(reply.id);
    if (!entry) return;
    if ('error' in reply) entry.reject(new Error(reply.error));
    else entry.resolve(reply.data);
  }

  private fail(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}

export function createFrameEncoder(profile: ProresProfile, colors: ColorTags, threads: number): FrameEncoder {
  if (threads < 2 || typeof Worker === 'undefined') return new InlineEncoder(profile, colors);
  try {
    return new WorkerPool(profile, colors, threads);
  } catch {
    return new InlineEncoder(profile, colors);
  }
}
