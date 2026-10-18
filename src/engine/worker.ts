import type { Port } from '../core/rpc';
import { serveEngine } from './server';

const engine = serveEngine(self as unknown as Port);
const report = (error: unknown) =>
  engine.emit('error', error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) });
self.addEventListener('error', (event) => report((event as ErrorEvent).error ?? (event as ErrorEvent).message));
self.addEventListener('unhandledrejection', (event) => report((event as PromiseRejectionEvent).reason));
