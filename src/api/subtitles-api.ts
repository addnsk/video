import { createId } from '../core/ids';
import type { SubtitleCue, SubtitleStyle } from '../core/model';
import {
  addCue,
  addSubtitleTrack,
  cuesAt,
  parseSubtitles,
  removeCue,
  removeSubtitleTrack,
  setCues,
  shiftCues,
  updateCue,
  updateSubtitleTrack,
  writeSrt,
  writeVtt,
  type SubtitleTrackOptions,
  type SubtitleTrackPatch,
} from '../core/subtitles';
import type { EditorSession } from '../host/session';

export function createSubtitlesApi(session: EditorSession) {
  const { store, transport } = session;
  const tracks = () => store.project.subtitles ?? [];
  const find = (id?: string) => {
    const list = tracks();
    const track = id ? list.find((t) => t.id === id) : list[0];
    if (!track) throw new Error(id ? `Unknown subtitle track ${id}` : 'There are no subtitle tracks');
    return track;
  };
  return {
    tracks: () => tracks().map(({ id, name, language, burnIn, visible, style, cues }) => ({ id, name, language, burnIn, visible, style, count: cues.length })),
    add(options: SubtitleTrackOptions = {}) {
      const id = createId('subtitles');
      store.dispatch(addSubtitleTrack(options, id));
      return id;
    },
    update: (id: string, patch: SubtitleTrackPatch) => void store.dispatch(updateSubtitleTrack(id, patch), { coalesce: `subtitles:${id}` }),
    style: (id: string, style: Partial<SubtitleStyle>) => void store.dispatch(updateSubtitleTrack(id, { style }), { coalesce: `subtitles:${id}` }),
    remove: (id: string) => void store.dispatch(removeSubtitleTrack(id)),
    cues: (id?: string): SubtitleCue[] => [...find(id).cues],
    addCue(id: string, cue: { start?: number; end?: number; text: string }) {
      const start = cue.start ?? transport.time;
      const cueId = createId('cue');
      store.dispatch(addCue(id, { start, end: cue.end ?? start + 2, text: cue.text }, cueId));
      return cueId;
    },
    updateCue: (id: string, cueId: string, patch: Partial<Omit<SubtitleCue, 'id'>>) => void store.dispatch(updateCue(id, cueId, patch), { coalesce: `cue:${cueId}` }),
    removeCue: (id: string, cueId: string) => void store.dispatch(removeCue(id, cueId)),
    shift: (id: string, seconds: number) => void store.dispatch(shiftCues(id, seconds)),
    import(text: string, options: SubtitleTrackOptions & { into?: string } = {}) {
      const cues = parseSubtitles(text);
      if (options.into) {
        store.dispatch(setCues(options.into, cues));
        return options.into;
      }
      const id = createId('subtitles');
      store.dispatch(addSubtitleTrack({ ...options, cues }, id));
      return id;
    },
    export: (id?: string, format: 'srt' | 'vtt' = 'srt') => (format === 'vtt' ? writeVtt : writeSrt)(find(id).cues),
    at: (time = transport.time) => tracks().filter((t) => t.visible || t.burnIn).flatMap((t) => cuesAt(t, time).map((c) => ({ track: t.id, ...c }))),
  };
}
