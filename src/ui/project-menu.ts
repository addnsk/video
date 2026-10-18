import { emptyProject } from '../core/model';
import { PROJECT_TYPES, pickFiles, saveBlob } from '../host/file-picker';
import type { ProjectPersistence } from '../host/persistence/project-persistence';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { Modal } from './components/modal';
import { toast } from './components/toast';
import { h } from './dom';

export function projectMenu(session: EditorSession, persistence: ProjectPersistence): HTMLElement {
  const status = h('span', { class: 'save-status', 'aria-live': 'polite' });
  persistence.on('saved', (at) => (status.textContent = t('savedAt', { time: at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));

  const confirmNew = () => {
    const modal = new Modal(t('newProject'));
    modal.body(
      h('p', { class: 'hint' }, t('newProjectWarning')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onClick: () => modal.close() }, t('cancel')),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            modal.close();
            session.transport.pause();
            session.store.reset(emptyProject());
            await persistence.discard();
            session.transport.seek(0);
          },
        }, t('newProject')),
      ),
    );
  };

  const open = async () => {
    const [picked] = await pickFiles({ ...PROJECT_TYPES, multiple: false });
    if (!picked) return;
    try {
      session.transport.pause();
      await persistence.open(picked.file);
      session.transport.seek(0);
      toast(t('projectOpened', { name: picked.file.name }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const save = async () => {
    const saved = await saveBlob(persistence.serialize(), 'project.montage.json', PROJECT_TYPES.description, PROJECT_TYPES.mime, '.json');
    if (saved) toast(t('projectSaved'));
  };

  return h('div', { class: 'menu' },
    h('button', { class: 'btn', id: 'project-new', onClick: confirmNew }, t('newProject')),
    h('button', { class: 'btn', id: 'project-open', onClick: () => void open() }, t('openProject')),
    h('button', { class: 'btn', id: 'project-save', onClick: () => void save() }, t('saveProject')),
    status,
  );
}
