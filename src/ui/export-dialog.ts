import { projectDuration } from '../core/timeline';
import type { DynamicRange } from '../engine/export/prores/color';
import { PRORES_PROFILES, type ProresProfile } from '../engine/export/prores/tables';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { Modal } from './components/modal';
import { toast } from './components/toast';
import { formatDuration, formatTimecode, h } from './dom';

const PROFILE_NAMES: Record<ProresProfile, string> = { proxy: '422 Proxy', lt: '422 LT', standard: '422', hq: '422 HQ' };

const RESOLUTIONS = [2160, 1440, 1080, 720, 540];

export function openExportDialog(session: EditorSession): void {
  const settings = session.store.project.settings;
  if (!settings) return;
  session.transport.pause();
  const modal = new Modal(t('exportTitle'));
  const resolution = h('select', { id: 'export-resolution' },
    h('option', { value: '0' }, t('sourceResolution', { width: settings.width, height: settings.height })),
    ...RESOLUTIONS.filter((r) => r < settings.height).map((r) => h('option', { value: String(r) }, `${r}p`)));
  if (settings.height > 1080) resolution.value = '1080';
  const format = h('select', { id: 'export-format' },
    h('option', { value: '' }, t('formatMp4')),
    ...PRORES_PROFILES.slice().reverse().map((p) => h('option', { value: p }, t('formatProres', { profile: PROFILE_NAMES[p] }))));
  const quality = h('select', { id: 'export-quality' },
    h('option', { value: 'high' }, t('qualityHigh')),
    h('option', { value: 'medium' }, t('qualityMedium')));
  const qualityField = h('label', { class: 'field' }, t('quality'), quality);
  const range = h('select', { id: 'export-range' },
    h('option', { value: 'sdr' }, t('rangeSdr')),
    h('option', { value: 'hlg' }, t('rangeHlg')),
    h('option', { value: 'pq' }, t('rangePq')));
  const rangeField = h('label', { class: 'field', hidden: true }, t('dynamicRange'), range);
  const proresHint = h('p', { class: 'hint', hidden: true }, t('proresHint'));
  format.addEventListener('change', () => {
    qualityField.hidden = !!format.value;
    proresHint.hidden = !format.value;
    rangeField.hidden = !format.value;
  });
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const duration = projectDuration(session.store.project);
  const status = h('p', { class: 'hint' }, t('exportInfo', { duration: formatTimecode(duration, settings.fps) }));
  const signal = { canceled: false };
  let busy = false;
  const cancel = h('button', { class: 'btn', onClick: () => (busy ? (signal.canceled = true) : modal.close()) }, t('cancel'));
  const run = h('button', { class: 'btn primary', id: 'export-run' }, t('exportRun'));
  modal.body(
    h('label', { class: 'field' }, t('resolution'), resolution),
    h('label', { class: 'field' }, t('format'), format),
    qualityField,
    rangeField,
    proresHint,
    progress,
    status,
    h('div', { class: 'row' }, cancel, run),
  );
  run.addEventListener('click', async () => {
    busy = true;
    run.disabled = true;
    progress.hidden = false;
    const started = performance.now();
    try {
      const result = await session.exportVideo(
        { height: +resolution.value || null, quality: quality.value as 'high' | 'medium', prores: (format.value || null) as ProresProfile | null, dynamicRange: format.value ? (range.value as DynamicRange) : 'sdr' },
        (fraction) => {
          progress.value = fraction;
          const elapsed = (performance.now() - started) / 1000;
          const left = fraction > 0.02 ? elapsed / fraction - elapsed : 0;
          status.textContent = t('exportLeft', { percent: Math.round(fraction * 100), left: formatDuration(left) });
        },
        signal,
      );
      showResult(modal, result.file, result.name, performance.now() - started);
    } catch (e) {
      busy = false;
      run.disabled = false;
      if (signal.canceled || (e as Error).name === 'AbortError') {
        modal.close();
        toast(t('exportCanceled'));
        return;
      }
      status.textContent = t('exportFailed', { message: (e as Error).message });
    }
  });
}

function showResult(modal: Modal, file: File | null, name: string, ms: number) {
  modal.title(t('exportDone'));
  const close = h('button', { class: 'btn', id: 'export-close' }, t('close'));
  if (!file) {
    close.addEventListener('click', () => modal.close());
    modal.body(h('p', { class: 'hint' }, t('exportSaved')), h('div', { class: 'row' }, close));
    return;
  }
  const url = URL.createObjectURL(file);
  close.addEventListener('click', () => {
    URL.revokeObjectURL(url);
    modal.close();
  });
  const preview = name.endsWith('.mp4') ? [h('video', { controls: true, playsInline: true, src: url })] : [];
  modal.body(
    ...preview,
    h('p', { class: 'hint' }, t('exportStats', { size: (file.size / 1048576).toFixed(1), seconds: (ms / 1000).toFixed(1) })),
    h('div', { class: 'row' }, close, h('a', { class: 'btn primary', href: url, download: name }, t('save'))),
  );
}
