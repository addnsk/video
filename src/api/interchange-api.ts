import { exportInterchange, type InterchangeFormat } from '../core/interchange';
import { activeTimeline } from '../core/timeline-data';
import type { EditorSession } from '../host/session';

export function createInterchangeApi(session: EditorSession) {
  const { store } = session;
  return {
    export: (format: InterchangeFormat, options: { timeline?: string; videoTrack?: number } = {}) => exportInterchange(store.project, format, { timeline: options.timeline ?? activeTimeline(store.project).id, videoTrack: options.videoTrack }),
    import: (text: string, options: { fileName?: string; format?: InterchangeFormat; open?: boolean } = {}) => session.importTimeline(text, options),
    offline: () => Object.values(store.project.assets).filter((a) => a.placeholder && session.missing.includes(a.id)).map((a) => ({ id: a.id, name: a.name })),
  };
}
