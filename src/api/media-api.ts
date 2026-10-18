import {
  METADATA_FIELDS,
  addBin,
  binContents,
  binsOf,
  entryOf,
  mediaKind,
  moveToBin,
  removeAsset,
  removeBin,
  renameAsset,
  searchMedia,
  setMetadata,
  updateBin,
  type MetadataPatch,
} from '../core/bins';
import { createId } from '../core/ids';
import type { AssetMeta, MediaMetadata } from '../core/model';
import type { EditorSession } from '../host/session';

export interface MediaInfo extends AssetMeta {
  readonly kind: 'video' | 'audio' | 'timeline';
  readonly bin: string | null;
  readonly metadata: MediaMetadata;
}

export function createMediaApi(session: EditorSession) {
  const { store } = session;
  const info = (asset: AssetMeta): MediaInfo => ({ ...asset, kind: mediaKind(asset), bin: entryOf(store.project, asset.id).bin ?? null, metadata: entryOf(store.project, asset.id).metadata ?? {} });
  const known = (assetId: string) => {
    const asset = store.project.assets[assetId];
    if (!asset) throw new Error(`No asset ${assetId}`);
    return asset;
  };
  return {
    list: (bin?: string | null): MediaInfo[] => (bin === undefined ? Object.values(store.project.assets) : binContents(store.project, bin)).map(info),
    get: (assetId: string) => info(known(assetId)),
    search: (query: string) => searchMedia(store.project, query).map(info),
    fields: () => [...METADATA_FIELDS],
    metadata: (assetId: string, patch?: MetadataPatch): MediaMetadata => {
      known(assetId);
      if (patch) store.dispatch(setMetadata(assetId, patch), { coalesce: `metadata:${assetId}` });
      return entryOf(store.project, assetId).metadata ?? {};
    },
    rename: (assetId: string, name: string) => void store.dispatch(renameAsset(assetId, name)),
    remove: (assetId: string) => {
      store.dispatch(removeAsset(assetId));
      session.files.delete(assetId);
    },
    bins: () => binsOf(store.project).map((b) => ({ ...b, count: binContents(store.project, b.id).length })),
    addBin: (name: string, options: { parent?: string | null; query?: string } = {}) => {
      const id = createId('bin');
      store.dispatch(addBin(name, options.parent ?? null, options.query, id));
      return id;
    },
    updateBin: (id: string, patch: { name?: string; parent?: string | null; query?: string | null }) => void store.dispatch(updateBin(id, patch)),
    removeBin: (id: string) => void store.dispatch(removeBin(id)),
    move: (assetIds: string | string[], bin: string | null) => void store.dispatch(moveToBin(Array.isArray(assetIds) ? assetIds : [assetIds], bin)),
  };
}
