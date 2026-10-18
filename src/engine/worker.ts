import type { Port } from '../core/rpc';
import { serveEngine } from './server';

serveEngine(self as unknown as Port);
