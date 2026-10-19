import type { RemoteStorage } from '../host/remote/remote-storage';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { Modal } from './components/modal';
import { toast } from './components/toast';
import { h } from './dom';

const formatSize = (bytes: number) => (bytes > 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${(bytes / (1 << 20)).toFixed(1)} MB`);

export function openCloudDialog(session: EditorSession, remote: RemoteStorage): void {
  const modal = new Modal(t('cloudTitle'));
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const busy = async (label: string, run: () => Promise<unknown>) => {
    status.textContent = label;
    try {
      await run();
      status.textContent = '';
    } catch (e) {
      status.textContent = (e as Error).message;
      toast((e as Error).message, 'error');
    }
  };

  const connectForm = () => {
    const field = (id: string, label: string, attrs: Record<string, unknown> = {}) => {
      const input = h('input', { id, type: 'text', autocomplete: 'off', ...attrs });
      return { input, row: h('label', { class: 'field' }, label, input) };
    };
    const endpoint = field('cloud-endpoint', t('cloudEndpoint'), { placeholder: 'https://s3.eu-central-1.amazonaws.com' });
    const region = field('cloud-region', t('cloudRegion'), { value: 'us-east-1' });
    const bucket = field('cloud-bucket', t('cloudBucket'));
    const prefix = field('cloud-prefix', t('cloudPrefix'), { placeholder: 'montage' });
    const key = field('cloud-key', t('cloudAccessKey'));
    const secret = field('cloud-secret', t('cloudSecret'), { type: 'password' });
    const pathStyle = h('input', { type: 'checkbox', id: 'cloud-path-style', checked: true });
    const remember = h('input', { type: 'checkbox', id: 'cloud-remember' });
    const connect = h('button', { class: 'btn primary', id: 'cloud-connect', onClick: () => busy(t('cloudConnecting'), async () => {
      await remote.connect({ endpoint: endpoint.input.value.trim(), region: region.input.value.trim() || 'us-east-1', bucket: bucket.input.value.trim(), prefix: prefix.input.value.trim(), accessKeyId: key.input.value.trim(), secretAccessKey: secret.input.value, pathStyle: pathStyle.checked }, remember.checked);
      render();
    }) }, t('cloudConnect'));
    return [
      h('p', { class: 'hint' }, t('cloudHint')),
      endpoint.row, region.row, bucket.row, prefix.row, key.row, secret.row,
      h('label', { class: 'check' }, pathStyle, t('cloudPathStyle')),
      h('label', { class: 'check' }, remember, t('cloudRemember')),
      status,
      h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => modal.close() }, t('close')), connect),
    ];
  };

  const projects = h('ul', { class: 'cloud-list', id: 'cloud-projects' });
  const media = h('ul', { class: 'cloud-list', id: 'cloud-media' });
  const progress = h('progress', { max: 1, value: 0, hidden: true });

  const refresh = () => busy(t('cloudLoading'), async () => {
    const [list, files] = await Promise.all([remote.projects(), remote.media()]);
    projects.replaceChildren(...(list.length ? list.map((p) => h('li', { 'data-project': p.key },
      h('b', {}, p.name),
      h('small', {}, `${new Date(p.lastModified).toLocaleString()} · ${formatSize(p.size)}`),
      h('span', { class: 'row' },
        h('button', { class: 'btn small', 'data-open': p.key, onClick: () => busy(t('cloudOpening'), async () => {
          session.transport.pause();
          await remote.openProject(p.key);
          session.transport.seek(0);
          modal.close();
          toast(t('projectOpened', { name: p.name }));
        }) }, t('cloudOpen')),
        h('button', { class: 'btn small', 'aria-label': t('cloudDelete'), onClick: () => {
          if (!confirm(t('cloudDeleteConfirm', { name: p.name }))) return;
          void busy(t('cloudLoading'), async () => {
            await remote.deleteProject(p.key);
            await refresh();
          });
        } }, '×'),
      ))) : [h('li', { class: 'hint' }, t('cloudNoProjects'))]));
    media.replaceChildren(...(files.length ? files.map((f) => h('li', { 'data-media': f.key },
      h('b', {}, f.name),
      h('small', {}, formatSize(f.size)),
      h('button', { class: 'btn small', 'data-import': f.key, disabled: f.inProject, onClick: () => busy(t('cloudImporting'), async () => {
        await remote.importMedia([f.key]);
        toast(t('added', { name: f.name }));
        await refresh();
      }) }, f.inProject ? t('cloudInProject') : t('cloudImport')),
    )) : [h('li', { class: 'hint' }, t('cloudNoMedia'))]));
  });

  const connected = () => {
    const config = remote.config!;
    const name = h('input', { type: 'text', id: 'cloud-project-name', value: session.store.project.timeline?.name ?? 'Project', 'aria-label': t('cloudProjectName') });
    const save = h('button', { class: 'btn primary', id: 'cloud-save', onClick: () => busy(t('cloudSaving'), async () => {
      await remote.saveProject(name.value);
      toast(t('projectSaved'));
      await refresh();
    }) }, t('cloudSave'));
    const upload = h('button', { class: 'btn', id: 'cloud-upload', onClick: () => busy(t('cloudUploading'), async () => {
      progress.hidden = false;
      const keys = await remote.upload(undefined, (file, fraction) => {
        progress.value = fraction;
        status.textContent = t('cloudUploadingFile', { name: file, percent: Math.round(fraction * 100) });
      });
      progress.hidden = true;
      toast(t('cloudUploaded', { count: keys.length }));
      await refresh();
    }) }, t('cloudUpload'));
    return [
      h('p', { class: 'hint' }, t('cloudConnected', { bucket: config.bucket, endpoint: new URL(config.endpoint).host })),
      h('h4', {}, t('cloudProjects')),
      h('div', { class: 'row' }, name, save),
      projects,
      h('h4', {}, t('cloudMedia')),
      h('div', { class: 'row' }, upload, progress),
      media,
      status,
      h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'cloud-disconnect', onClick: () => {
          remote.disconnect();
          render();
        } }, t('cloudDisconnect')),
        h('button', { class: 'btn', onClick: () => void refresh() }, t('cloudRefresh')),
        h('button', { class: 'btn', id: 'cloud-close', onClick: () => modal.close() }, t('close')),
      ),
    ];
  };

  const render = () => {
    modal.body(...(remote.connected ? connected() : connectForm()));
    if (remote.connected) void refresh();
  };
  render();
}
