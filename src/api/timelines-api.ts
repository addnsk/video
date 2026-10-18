import { linkedIds } from '../core/editing';
import { createId } from '../core/ids';
import type { Operation } from '../core/operations';
import {
  activeTimeline,
  addTimeline,
  duplicateTimeline,
  ensureNestedAsset,
  nestItems,
  nestedAssetId,
  removeTimeline,
  renameTimeline,
  switchTimeline,
  timelineList,
  setTimelineFormat,
  type TimelineFormat,
  type TimelineInfo,
} from '../core/timelines';
import type { EditorSession } from '../host/session';

export function createTimelinesApi(session: EditorSession, resolveId: (ref: string | number) => string) {
  const { store } = session;
  const apply = (op: Operation) => store.dispatch(op);
  const known = (id: string) => {
    if (!timelineList(store.project).some((t) => t.id === id)) throw new Error(`No timeline ${id}. Timelines: ${timelineList(store.project).map((t) => `${t.id} (${t.name})`).join(', ')}`);
  };
  return {
    list: (): TimelineInfo[] => timelineList(store.project),
    active: () => activeTimeline(store.project),
    create: (name?: string, options: { open?: boolean } & TimelineFormat = {}) => {
      const id = createId('timeline');
      const { open: _open, ...format } = options;
      store.transaction(() => {
        apply(addTimeline(name, id, undefined, format));
        if (options.open !== false) apply(switchTimeline(id));
      });
      return id;
    },
    open: (id: string) => {
      known(id);
      session.transport.pause();
      apply(switchTimeline(id));
      session.transport.seek(0);
    },
    rename: (id: string, name: string) => {
      known(id);
      apply(renameTimeline(id, name));
    },
    duplicate: (id: string = activeTimeline(store.project).id) => {
      known(id);
      const copy = createId('timeline');
      apply(duplicateTimeline(id, copy));
      return copy;
    },
    remove: (id: string) => {
      known(id);
      apply(removeTimeline(id));
    },
    format: (patch?: TimelineFormat) => {
      if (patch) apply(setTimelineFormat(patch));
      const settings = store.project.settings;
      return settings ? { width: settings.width, height: settings.height, fps: settings.fps } : null;
    },
    asset: (id: string) => {
      known(id);
      apply(ensureNestedAsset(id));
      return nestedAssetId(id);
    },
    compound: (refs: (string | number)[], name?: string) => {
      const ids = [...new Set(refs.map(resolveId).flatMap((id) => linkedIds(store.project, id)))];
      const timeline = createId('timeline');
      const item = createId('item');
      apply(nestItems(ids, name, timeline, item));
      return { timeline, clip: item, asset: nestedAssetId(timeline) };
    },
  };
}
