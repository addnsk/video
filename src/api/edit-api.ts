import {
  addMarker,
  clipTargets,
  deleteItems,
  extractRange,
  insertEdit,
  liftRange,
  linkItems,
  linkedIds,
  markerColors,
  overwriteEdit,
  removeMarker,
  rippleTrim,
  rollEdit,
  slideEdit,
  slipEdit,
  unlinkItems,
  updateMarker,
  type Edge,
  type RippleScope,
} from '../core/editing';
import { createId } from '../core/ids';
import type { Marker } from '../core/model';
import { addTrack, type Operation } from '../core/operations';
import { projectDuration } from '../core/timeline';
import { resolveThreePoint, type MarkRange } from '../core/three-point';
import type { EditorSession } from '../host/session';
import type { Viewer } from '../host/source-monitor';

export interface EditOptions {
  asset?: string;
  in?: number;
  out?: number;
  at?: number;
  until?: number;
  video?: string | null;
  audio?: string | null;
  ripple?: 'all' | 'track' | string[];
}

export interface EditResult {
  readonly video: string | null;
  readonly audio: string | null;
  readonly start: number;
  readonly duration: number;
}

const EDGES: readonly Edge[] = ['in', 'out'];

export function createEditApi(session: EditorSession, resolveId: (ref: string | number) => string) {
  const { store, source, marks, transport } = session;
  const apply = (op: Operation) => store.dispatch(op);
  const edge = (value: string): Edge => {
    if (!EDGES.includes(value as Edge)) throw new Error('Edge must be "in" or "out"');
    return value as Edge;
  };

  const audioTrack = (requested: string | null | undefined): string | null => {
    if (requested !== undefined) return requested;
    const existing = store.project.tracks.find((t) => t.kind === 'audio');
    if (existing) return existing.id;
    const id = createId('a');
    apply(addTrack('audio', id));
    return id;
  };

  const sourceMarks = (assetId: string): MarkRange & { playhead: number } => {
    if (source.assetId !== assetId) return { playhead: 0 };
    return { ...source.marks, playhead: source.transport.time };
  };

  const plan = (options: EditOptions) => {
    const assetId = options.asset ?? source.assetId;
    if (!assetId) throw new Error('Open a clip in the source viewer or pass { asset }');
    const asset = store.project.assets[assetId];
    if (!asset) throw new Error(`No asset ${assetId}`);
    const viewer = sourceMarks(assetId);
    const local = (t: number | undefined) => (t === undefined ? undefined : asset.start + t);
    const recordMarks = options.at !== undefined || options.until !== undefined ? { in: options.at, out: options.until } : marks.value;
    const edit = resolveThreePoint({
      source: {
        in: options.in ?? local(viewer.in),
        out: options.out ?? local(viewer.out),
        playhead: asset.start + viewer.playhead,
        start: asset.start,
        end: asset.end,
      },
      record: { ...recordMarks, playhead: transport.time },
    });
    return { assetId, edit };
  };

  const perform = (options: EditOptions, mode: 'insert' | 'overwrite' | 'append'): EditResult => {
    let result: EditResult | null = null;
    void store.transaction(() => {
      const { assetId, edit } = plan(options);
      const ids = { video: createId('item'), audio: createId('item') };
      const targets = clipTargets(
        store.project,
        { assetId, sourceIn: edit.sourceIn, sourceOut: edit.sourceOut, speed: edit.speed, videoTrack: options.video === undefined ? session.videoTrackId : options.video, audioTrack: audioTrack(options.audio) },
        ids,
      );
      const at = mode === 'append' ? Math.max(0, ...targets.map((t) => projectDurationOf(t.trackId))) : edit.recordIn;
      const scope: RippleScope = Array.isArray(options.ripple) ? options.ripple : (options.ripple ?? 'all');
      apply(mode === 'overwrite' || mode === 'append' ? overwriteEdit(targets, at) : insertEdit(targets, at, scope));
      const placed = (id: string) => targets.some((t) => t.item.id === id) ? id : null;
      result = { video: placed(ids.video), audio: placed(ids.audio), start: at, duration: (edit.sourceOut - edit.sourceIn) / edit.speed };
    });
    return result!;
  };

  const projectDurationOf = (trackId: string) => {
    const track = store.project.tracks.find((t) => t.id === trackId);
    return track ? projectDuration({ ...store.project, tracks: [track] }) : 0;
  };

  const range = (from?: number, to?: number): [number, number] => {
    const a = from ?? marks.value.in;
    const b = to ?? marks.value.out;
    if (a === undefined || b === undefined) throw new Error('Set timeline In and Out marks or pass a range');
    if (b <= a) throw new Error('Out must be after In');
    return [a, b];
  };
  const trackList = (tracks?: string[]) => tracks ?? store.project.tracks.map((t) => t.id);

  return {
    source: {
      open: (assetId: string) => source.open(assetId),
      close: () => source.close(),
      show: (viewer: Viewer) => source.show(viewer),
      state: () => ({ ...source.state, time: source.transport.time }),
      mark: (next: { in?: number | null; out?: number | null }) => source.mark(next),
      seek: (time: number) => source.transport.seek(time),
      play: (rate = 1) => source.transport.play(rate),
      pause: () => source.transport.pause(),
    },
    marks: (next?: { in?: number | null; out?: number | null }): MarkRange => (next ? marks.set(next) : marks.value),
    edit: {
      insert: (options: EditOptions = {}) => perform(options, 'insert'),
      overwrite: (options: EditOptions = {}) => perform(options, 'overwrite'),
      append: (options: EditOptions = {}) => perform(options, 'append'),
      lift: (from?: number, to?: number, tracks?: string[]) => void apply(liftRange(trackList(tracks), ...range(from, to))),
      extract: (from?: number, to?: number, tracks?: string[]) => void apply(extractRange(trackList(tracks), ...range(from, to))),
      delete: (refs: (string | number)[] | string | number, options: { ripple?: boolean; tracks?: 'linked' | 'all' | string[] } = {}) =>
        void apply(deleteItems((Array.isArray(refs) ? refs : [refs]).map(resolveId), !!options.ripple, options.tracks ?? 'linked')),
      ripple: (ref: string | number, side: Edge, delta: number, tracks: 'linked' | 'all' | string[] = 'linked') =>
        void apply(rippleTrim(resolveId(ref), edge(side), delta, tracks)),
      roll: (ref: string | number, side: Edge, delta: number) => void apply(rollEdit(resolveId(ref), edge(side), delta)),
      slip: (ref: string | number, delta: number) => void apply(slipEdit(resolveId(ref), delta)),
      slide: (ref: string | number, delta: number) => void apply(slideEdit(resolveId(ref), delta)),
      link: (refs: (string | number)[]) => {
        if (refs.length < 2) throw new Error('Link needs at least two clips');
        apply(linkItems(refs.map(resolveId)));
      },
      unlink: (refs: (string | number)[] | string | number) => {
        const ids = (Array.isArray(refs) ? refs : [refs]).map(resolveId);
        apply(unlinkItems([...new Set(ids.flatMap((id) => linkedIds(store.project, id)))]));
      },
      linked: (ref: string | number) => linkedIds(store.project, resolveId(ref)),
    },
    markers: {
      add: (marker: Partial<Omit<Marker, 'id'>> = {}) => {
        const id = createId('marker');
        apply(addMarker({ ...marker, time: marker.time ?? transport.time }, id));
        return id;
      },
      list: (): Marker[] => [...(store.project.markers ?? [])],
      update: (id: string, patch: Partial<Omit<Marker, 'id'>>) => {
        if (!store.project.markers?.some((m) => m.id === id)) throw new Error(`No marker ${id}`);
        apply(updateMarker(id, patch));
      },
      remove: (id: string) => void apply(removeMarker(id)),
      colors: () => [...markerColors()],
      next: (time = transport.time) => store.project.markers?.find((m) => m.time > time + 1e-6) ?? null,
      previous: (time = transport.time) => [...(store.project.markers ?? [])].reverse().find((m) => m.time < time - 1e-6) ?? null,
    },
  };
}
