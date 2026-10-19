import type { RenderJob, RenderJobSpec } from '../host/render-queue';
import { RENDER_PRESETS } from '../host/render-queue';
import type { EditorSession } from '../host/session';

const info = (job: RenderJob) => ({ id: job.id, name: job.name, timeline: job.timeline, settings: job.settings, status: job.status, progress: job.progress, error: job.error, size: job.file?.size ?? null });

export function createQueueApi(session: EditorSession) {
  const { queue } = session;
  const find = (id: string) => {
    const job = queue.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Unknown render job ${id}`);
    return job;
  };
  return {
    presets: () => RENDER_PRESETS.map(({ id, label, settings }) => ({ id, label, settings })),
    add: (spec: RenderJobSpec = {}) => info(queue.add(spec)),
    outputs: (timelines: string[], presets: string[]) => queue.addOutputs(timelines, presets).map(info),
    list: () => queue.jobs.map(info),
    remove: (id: string) => queue.remove(id),
    retry: (id: string) => queue.retry(id),
    clearFinished: () => queue.clearFinished(),
    start: async () => {
      await queue.start();
      return queue.jobs.map(info);
    },
    stop: () => queue.stop(),
    file: (id: string) => find(id).file,
  };
}
