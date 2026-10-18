import { connect, localChannel, transfer, type Remote } from '../core/rpc';
import type { Emitter } from '../core/emitter';
import { detectDevice, type MemoryBudget } from '../engine/device';
import type { EngineEvents, EngineMethods } from '../engine/protocol';

export type EngineMode = 'worker' | 'inline';

export interface EngineClient {
  readonly remote: Remote<EngineMethods>;
  readonly events: Emitter<EngineEvents>;
  readonly budget: MemoryBudget;
  readonly mode: EngineMode;
}

function supportsWorkerRendering(canvas: HTMLCanvasElement): boolean {
  if (typeof canvas.transferControlToOffscreen !== 'function' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    return !!new OffscreenCanvas(1, 1).getContext('webgl2');
  } catch {
    return false;
  }
}

export async function startEngine(canvas: HTMLCanvasElement): Promise<EngineClient> {
  const device = detectDevice();
  if (supportsWorkerRendering(canvas)) {
    const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module', name: 'engine' });
    const { remote, events } = connect<EngineMethods, EngineEvents>(worker);
    const surface = canvas.transferControlToOffscreen();
    const budget = await remote.init(transfer({ surface, device }, [surface]) as never);
    return { remote, events, budget, mode: 'worker' };
  }
  const { serveEngine } = await import('../engine/server');
  const [client, server] = localChannel();
  serveEngine(server);
  const { remote, events } = connect<EngineMethods, EngineEvents>(client);
  const budget = await remote.init({ surface: canvas, device });
  return { remote, events, budget, mode: 'inline' };
}
