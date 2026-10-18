import { serve, type Port } from '../core/rpc';
import { Engine } from './engine';
import type { EngineEvents, EngineMethods } from './protocol';

export function serveEngine(port: Port): Engine {
  const engine = new Engine();
  const methods = new Proxy({} as EngineMethods, {
    get: (_, name: string) => {
      const value = (engine as unknown as Record<string, unknown>)[name];
      return typeof value === 'function' ? value.bind(engine) : undefined;
    },
  });
  serve<EngineMethods, EngineEvents>(port, methods, engine, ['progress', 'proxy', 'error', 'context']);
  return engine;
}
