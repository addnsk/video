import { Decoder } from 'turbores';

type Run = (...args: unknown[]) => Promise<unknown>;

interface SharedDecoder {
  readonly useSharedMemory: boolean;
  _runDecode: Run;
  _runClose: () => void;
}

let installed = false;
let chain: Promise<unknown> = Promise.resolve();

const serialized = <T>(task: () => T | Promise<T>): Promise<T> => {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
};

export function serializeSharedProresDecoding(): void {
  if (installed) return;
  installed = true;
  const create = Decoder.create.bind(Decoder);
  Decoder.create = (async (options: Parameters<typeof Decoder.create>[0]) => {
    const decoder = await create(options);
    if (decoder instanceof Error) return decoder;
    const shared = decoder as unknown as SharedDecoder;
    if (!shared.useSharedMemory) return decoder;
    const run = shared._runDecode.bind(shared);
    const close = shared._runClose.bind(shared);
    shared._runDecode = (...args) => serialized(() => run(...args));
    shared._runClose = () => void serialized(close);
    return decoder;
  }) as typeof Decoder.create;
}
