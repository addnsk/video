import { alignEnvelopes } from '../effects/audio/sync';
import { PEAKS_PER_SECOND } from '../engine/audio/peaks';
import type { EditorSession } from './session';

export interface AngleSync {
  readonly assetId: string;
  readonly offset: number;
  readonly confidence: number;
}

export async function syncByAudio(session: EditorSession, assetIds: readonly string[]): Promise<AngleSync[]> {
  const assets = assetIds.map((id) => {
    const asset = session.store.project.assets[id];
    if (!asset) throw new Error(`No asset ${id}`);
    return asset;
  });
  const reference = assets.find((a) => a.hasAudio && session.files.has(a.id));
  if (!reference) throw new Error('Audio sync needs at least one angle with sound');
  const peaks = new Map<string, Float32Array>();
  await Promise.all(assets.filter((a) => a.hasAudio && session.files.has(a.id)).map(async (a) => peaks.set(a.id, (await session.engine.remote.peaks(a.id)) as Float32Array)));
  const base = peaks.get(reference.id)!;
  return assets.map((asset) => {
    if (asset.id === reference.id) return { assetId: asset.id, offset: 0, confidence: 1 };
    const own = peaks.get(asset.id);
    if (!own) return { assetId: asset.id, offset: 0, confidence: 0 };
    const { offset, confidence } = alignEnvelopes(base, own, PEAKS_PER_SECOND);
    return { assetId: asset.id, offset: offset - reference.start + asset.start, confidence };
  });
}
