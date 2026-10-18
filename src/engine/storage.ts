import type { StreamTargetChunk } from 'mediabunny';

type SyncAccessHandle = {
  write(data: BufferSource, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
};

type SyncCapableHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };

interface Writer {
  write(data: Uint8Array, position: number): void | Promise<void>;
  close(): Promise<void>;
}

async function openWriter(handle: FileSystemFileHandle): Promise<Writer> {
  const syncCapable = handle as SyncCapableHandle;
  if (typeof syncCapable.createSyncAccessHandle === 'function') {
    const sync = await syncCapable.createSyncAccessHandle();
    sync.truncate(0);
    let closed = false;
    return {
      write: (data, at) => void sync.write(data as Uint8Array<ArrayBuffer>, { at }),
      async close() {
        if (closed) return;
        closed = true;
        sync.flush();
        sync.close();
      },
    };
  }
  const stream = await (handle as unknown as { createWritable(o: { keepExistingData: boolean }): Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: false });
  let closed = false;
  return {
    write: (data, position) => stream.write({ type: 'write', position, data: data as Uint8Array<ArrayBuffer> }),
    async close() {
      if (closed) return;
      closed = true;
      await stream.close();
    },
  };
}

export interface WritableFile {
  readonly writable: WritableStream<StreamTargetChunk>;
  finish(): Promise<File>;
  abort(): Promise<void>;
}

export interface StoredFile {
  read(): Promise<File | null>;
  open(): Promise<WritableFile>;
  remove(): Promise<void>;
}

async function directory(path: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(path, { create: true });
}

export function opfsFile(dir: string, name: string): StoredFile {
  return {
    async read() {
      try {
        const handle = await (await directory(dir)).getFileHandle(name);
        return await handle.getFile();
      } catch {
        return null;
      }
    },
    async open() {
      const folder = await directory(dir);
      const handle = await folder.getFileHandle(name, { create: true });
      const writer = await openWriter(handle);
      return {
        writable: new WritableStream<StreamTargetChunk>({
          write: (chunk) => writer.write(chunk.data, chunk.position),
        }),
        async finish() {
          await writer.close();
          return handle.getFile();
        },
        async abort() {
          await writer.close();
          await folder.removeEntry(name).catch(() => undefined);
        },
      };
    },
    async remove() {
      await (await directory(dir)).removeEntry(name).catch(() => undefined);
    },
  };
}

export async function clearDirectory(dir: string, keep: ReadonlySet<string> = new Set()): Promise<void> {
  const folder = await directory(dir);
  const names: string[] = [];
  for await (const name of (folder as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
  await Promise.all(names.filter((n) => !keep.has(n)).map((n) => folder.removeEntry(n).catch(() => undefined)));
}
