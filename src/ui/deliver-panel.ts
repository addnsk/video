import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { h } from './dom';
import { openExportDialog } from './export-dialog';
import { openRenderQueue } from './render-queue-dialog';

export function deliverPanel(session: EditorSession): HTMLElement {
  return h('section', { class: 'panel', id: 'deliver' },
    h('h2', {}, t('pageDeliver')),
    h('div', { class: 'group' },
      h('p', { class: 'hint' }, t('deliverHint')),
      h('button', { class: 'btn primary', id: 'deliver-export', onClick: () => openExportDialog(session) }, t('export')),
      h('button', { class: 'btn', id: 'deliver-queue', onClick: () => openRenderQueue(session) }, t('queueTitle')),
    ),
  );
}
