import type { RemoteStorage } from '../host/remote/remote-storage';
import type { S3Config } from '../host/remote/s3';

export function createRemoteApi(remote: RemoteStorage | null) {
  const require = () => {
    if (!remote) throw new Error('Remote storage is not available here');
    return remote;
  };
  return {
    connect: (config: S3Config & { remember?: boolean }) => {
      const { remember, ...rest } = config;
      return require().connect(rest, remember ?? false);
    },
    disconnect: () => require().disconnect(),
    status: () => ({ connected: remote?.connected ?? false, config: remote?.config ?? null }),
    projects: () => require().projects(),
    saveProject: (name: string) => require().saveProject(name),
    openProject: (key: string) => require().openProject(key),
    deleteProject: (key: string) => require().deleteProject(key),
    media: () => require().media(),
    importMedia: async (keys: string | string[], options: { place?: boolean } = {}) => (await require().importMedia(Array.isArray(keys) ? keys : [keys], options.place ?? true)).map((a) => a.id),
    upload: (assetIds?: string[], options: { onProgress?: (name: string, fraction: number) => void } = {}) => require().upload(assetIds, options.onProgress),
    reconnect: () => require().attachMissing(),
  };
}
