export interface FrameStore {
  read(key: string): Promise<Blob | null>;
  write(key: string, blob: Blob): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DIRECTORY = 'render-cache';

export async function opfsFrameStore(): Promise<FrameStore | null> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return null;
    await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined);
    let dir = await root.getDirectoryHandle(DIRECTORY, { create: true });
    return {
      async read(key) {
        try {
          return await (await dir.getFileHandle(key)).getFile();
        } catch {
          return null;
        }
      },
      async write(key, blob) {
        const handle = await dir.getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      },
      async remove(key) {
        await dir.removeEntry(key).catch(() => undefined);
      },
      async clear() {
        await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined);
        dir = await root.getDirectoryHandle(DIRECTORY, { create: true });
      },
    };
  } catch {
    return null;
  }
}

export function memoryFrameStore(): FrameStore {
  const files = new Map<string, Blob>();
  return {
    read: async (key) => files.get(key) ?? null,
    write: async (key, blob) => void files.set(key, blob),
    remove: async (key) => void files.delete(key),
    clear: async () => files.clear(),
  };
}
