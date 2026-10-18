import { Emitter } from '../../../src/core/emitter';
import type { AssetMeta } from '../../../src/core/model';
import type { Remote } from '../../../src/core/rpc';
import { budgetFor } from '../../../src/engine/device';
import type { EngineEvents, EngineMethods } from '../../../src/engine/protocol';
import type { EngineClient } from '../../../src/host/engine-client';
import { asset } from '../fixtures';

export interface Call {
  readonly method: keyof EngineMethods;
  readonly args: unknown[];
}

export class FakeEngine implements EngineClient {
  readonly events = new Emitter<EngineEvents>();
  readonly budget = budgetFor({ memoryGb: 8, cores: 8, ios: false, touch: false });
  readonly mode = 'inline' as const;
  readonly calls: Call[] = [];
  readonly remote: Remote<EngineMethods>;

  constructor(private durations: Record<string, number> = {}) {
    const handlers: Partial<Record<keyof EngineMethods, (...args: never[]) => unknown>> = {
      probe: (id: string, file: File) => this.probe(id, file),
      renderStill: () => true,
      exportVideo: () => new File([new Uint8Array(4)], 'out.mp4'),
      peaks: () => new Float32Array([0, 1]),
      stats: () => ({ budget: this.budget, resources: {}, frameCacheBytes: 0, floatTargets: true }),
    };
    this.remote = new Proxy({} as Remote<EngineMethods>, {
      get: (_, method: keyof EngineMethods) => async (...args: unknown[]) => {
        this.calls.push({ method, args });
        const handler = handlers[method] as ((...a: unknown[]) => unknown) | undefined;
        return handler?.(...args);
      },
    });
  }

  called(method: keyof EngineMethods): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  private probe(id: string, file: File): AssetMeta {
    if (file.name.endsWith('.fail')) throw new Error(`Unsupported ${file.name}`);
    const meta = { ...asset(id, this.durations[file.name] ?? 10), name: file.name };
    return file.name.endsWith('.wav') ? { ...meta, hasVideo: false, width: 0, height: 0, fps: 0 } : meta;
  }
}

export const file = (name: string) => new File([new Uint8Array(1)], name);
export const flush = () => new Promise((r) => setTimeout(r, 0));
