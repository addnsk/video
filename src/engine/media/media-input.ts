import { BlobSource, UrlSource, type Source } from 'mediabunny';

export interface RemoteMedia {
  readonly kind: 'remote';
  readonly url: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

export type MediaInput = File | RemoteMedia;

export const isRemote = (input: MediaInput): input is RemoteMedia => !(input instanceof Blob) && input.kind === 'remote';

const REMOTE_CACHE_BYTES = 64 * 1024 * 1024;

export function sourceOf(input: MediaInput, maxCacheSize?: number): Source {
  if (!isRemote(input)) return new BlobSource(input, maxCacheSize ? { maxCacheSize } : {});
  return new UrlSource(input.url, { maxCacheSize: Math.max(maxCacheSize ?? 0, REMOTE_CACHE_BYTES), requestInit: { mode: 'cors', credentials: 'omit' } });
}
