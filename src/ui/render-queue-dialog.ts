import { timelineList } from '../core/timelines';
import { RENDER_PRESETS, type RenderJob } from '../host/render-queue';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { Modal } from './components/modal';
import { h } from './dom';

export function openRenderQueue(session: EditorSession): void {
  const { queue } = session;
  const modal = new Modal(t('queueTitle'));
  const urls = new Map<File, string>();
  const urlOf = (file: File) => {
    let url = urls.get(file);
    if (!url) urls.set(file, (url = URL.createObjectURL(file)));
    return url;
  };
  const timelines = h('div', { class: 'checks', id: 'queue-timelines' },
    ...timelineList(session.store.project).map((tl) => h('label', {}, h('input', { type: 'checkbox', value: tl.id, checked: tl.active }), tl.name)));
  const presets = h('div', { class: 'checks', id: 'queue-presets' },
    ...RENDER_PRESETS.map((p, i) => h('label', {}, h('input', { type: 'checkbox', value: p.id, checked: i === 0 }), p.label)));
  const checked = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
  const add = h('button', { class: 'btn', id: 'queue-add', onClick: () => queue.addOutputs(checked(timelines), checked(presets)) }, t('queueAdd'));
  const list = h('ul', { class: 'queue-list', id: 'queue-list' });
  const start = h('button', { class: 'btn primary', id: 'queue-start', onClick: () => void queue.start() }, t('queueStart'));
  const stop = h('button', { class: 'btn', id: 'queue-stop', onClick: () => queue.stop() }, t('queueStop'));
  const clear = h('button', { class: 'btn', id: 'queue-clear', onClick: () => queue.clearFinished() }, t('queueClear'));
  const close = h('button', { class: 'btn', id: 'queue-close', onClick: () => modal.close() }, t('close'));

  const row = (job: RenderJob) => {
    const actions: Node[] = [];
    if (job.file) actions.push(h('a', { class: 'btn', href: urlOf(job.file), download: job.name, 'data-save': job.id }, t('save')));
    if (job.status === 'failed' || job.status === 'canceled') actions.push(h('button', { class: 'btn', 'data-retry': job.id, onClick: () => queue.retry(job.id) }, t('queueRetry')));
    if (job.status !== 'rendering') actions.push(h('button', { class: 'btn', 'data-remove': job.id, onClick: () => queue.remove(job.id) }, '✕'));
    return h('li', { 'data-job': job.id, 'data-status': job.status },
      h('b', {}, job.name),
      h('progress', { max: 1, value: job.progress }),
      h('small', {}, job.error ? t('exportFailed', { message: job.error }) : t(`queue_${job.status}`)),
      h('span', { class: 'row' }, ...actions));
  };
  let shape = '';
  const render = () => {
    const next = queue.jobs.map((j) => `${j.id}:${j.status}`).join() + queue.busy;
    if (next === shape) {
      for (const job of queue.jobs) list.querySelector<HTMLProgressElement>(`[data-job="${job.id}"] progress`)!.value = job.progress;
      return;
    }
    shape = next;
    list.replaceChildren(...queue.jobs.map(row));
    if (!queue.jobs.length) list.append(h('li', { class: 'hint' }, t('queueEmpty')));
    start.disabled = queue.busy || !queue.jobs.some((j) => j.status === 'queued');
    stop.disabled = !queue.busy;
    clear.disabled = !queue.jobs.some((j) => j.status !== 'queued' && j.status !== 'rendering');
  };
  const off = queue.on('change', render);
  modal.onClose(() => {
    off();
    for (const url of urls.values()) URL.revokeObjectURL(url);
  });
  modal.body(
    h('p', { class: 'hint' }, t('queueTimelines')), timelines,
    h('p', { class: 'hint' }, t('queuePresets')), presets,
    h('div', { class: 'row' }, add),
    list,
    h('p', { class: 'hint' }, t('queueHint')),
    h('div', { class: 'row' }, close, clear, stop, start),
  );
  render();
}
