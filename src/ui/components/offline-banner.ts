import { MEDIA_TYPES, pickFiles } from '../../host/file-picker';
import type { ProjectPersistence } from '../../host/persistence/project-persistence';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { h } from '../dom';
import { toast } from './toast';

export function offlineBanner(session: EditorSession, persistence: ProjectPersistence): HTMLElement {
  const text = h('span');
  const banner = h('div', { class: 'offline', role: 'status', hidden: true },
    text,
    h('button', {
      class: 'btn',
      id: 'media-reconnect',
      onClick: async () => {
        const count = await persistence.reconnect(true);
        if (!count) toast(t('reconnectNone'));
      },
    }, t('reconnect')),
    h('button', {
      class: 'btn primary',
      id: 'media-locate',
      onClick: async () => {
        const picked = await pickFiles({ ...MEDIA_TYPES, multiple: true });
        const count = persistence.relink(picked.map((p) => p.file));
        picked.forEach((p) => {
          const meta = Object.values(session.store.project.assets).find((a) => a.name === p.file.name && a.size === p.file.size);
          if (meta && p.handle) void persistence.rememberHandle(meta.id, p.handle);
        });
        toast(t('relinked', { count }));
      },
    }, t('locateFiles')),
  );
  const sync = () => {
    const missing = session.missing;
    banner.hidden = missing.length === 0;
    text.textContent = t('mediaOffline', { count: missing.length, names: missing.map((id) => session.store.project.assets[id]?.name).join(', ') });
  };
  session.on('media', sync);
  session.store.on('change', ({ project, previous }) => project.assets !== previous.assets && sync());
  sync();
  return banner;
}
