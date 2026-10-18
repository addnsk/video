import { createId } from '../core/ids';
import type { MediaItem } from '../core/model';
import { createMulticam, multicamOf, setAngle, switchAngle, type AngleSource } from '../core/multicam';
import { findPlacement } from '../core/timeline';
import { nestedAssetId } from '../core/timelines';
import { syncByAudio } from '../host/multicam-sync';
import type { EditorSession } from '../host/session';

export function createMulticamApi(session: EditorSession, resolveId: (ref: string | number) => string) {
  const { store, transport } = session;
  const clipAt = (time: number, track?: string) => {
    const tracks = track ? store.project.tracks.filter((t) => t.id === track) : store.project.tracks.filter((t) => t.kind === 'video');
    for (const t of tracks)
      for (const item of t.items) {
        const p = findPlacement(store.project, item.id)!;
        if (time >= p.start - 1e-6 && time < p.end - 1e-6 && multicamOf(store.project, item)) return p;
      }
    return null;
  };
  return {
    sync: (assetIds: string[]) => syncByAudio(session, assetIds),
    async create(name: string, angles: (string | AngleSource)[], options: { sync?: 'audio' | 'none' } = {}) {
      let sources: AngleSource[] = angles.map((a) => (typeof a === 'string' ? { assetId: a } : a));
      const synced = options.sync === 'audio' ? await syncByAudio(session, sources.map((s) => s.assetId)) : null;
      if (synced) sources = sources.map((s, i) => ({ ...s, offset: s.offset ?? synced[i].offset }));
      const id = createId('timeline');
      store.dispatch(createMulticam(name, sources, id));
      return { timeline: id, asset: nestedAssetId(id), offsets: sources.map((s) => s.offset ?? 0), confidence: synced?.map((s) => s.confidence) ?? null };
    },
    angles(ref: string | number) {
      const id = resolveId(ref);
      const item = findPlacement(store.project, id)!.item as MediaItem;
      const multicam = multicamOf(store.project, item);
      if (!multicam) throw new Error('This clip is not a multicam clip');
      return { names: multicam.angles.map((a) => a.name), video: item.angle ?? 0, audio: item.audioAngle ?? item.angle ?? 0 };
    },
    angle: (ref: string | number, angle: { video?: number; audio?: number | null }) => void store.dispatch(setAngle(resolveId(ref), angle)),
    cut(angle: number, options: { time?: number; track?: string; only?: 'video' | 'audio' } = {}) {
      const time = options.time ?? transport.time;
      const hit = clipAt(time, options.track);
      if (!hit) throw new Error('No multicam clip under the playhead');
      const target = options.only === 'video' ? { video: angle } : options.only === 'audio' ? { audio: angle } : { video: angle, audio: null };
      store.dispatch(switchAngle(time, hit.track.id, target));
    },
    view: (assetId: string) => session.source.open(assetId),
  };
}
