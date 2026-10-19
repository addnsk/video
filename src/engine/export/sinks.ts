import type { StreamTargetChunk } from 'mediabunny';
import { clearDirectory, opfsFile } from '../storage';

export interface ByteSink {
  readonly writable: WritableStream<StreamTargetChunk>;
  finish(): Promise<File | null>;
  abort(): Promise<void>;
}

const EXPORT_DIR = 'exports';

export async function storageSink(name: string, folder = EXPORT_DIR, clear = true): Promise<ByteSink> {
  if (clear) await clearDirectory(folder);
  return opfsFile(folder, name).open();
}

export async function fileHandleSink(handle: FileSystemFileHandle): Promise<ByteSink> {
  const stream = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  return {
    writable: new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        await stream.write({ type: 'write', position: chunk.position, data: chunk.data });
      },
    }),
    async finish() {
      await stream.close();
      return null;
    },
    async abort() {
      await stream.abort();
    },
  };
}
