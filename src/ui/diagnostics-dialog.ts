import type { LogEntry } from '../core/log';
import { saveBlob } from '../host/file-picker';
import { platformNotes } from '../host/platform-report';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { Modal } from './components/modal';
import { toast } from './components/toast';
import { icon } from './icons';
import { h } from './dom';

async function context(session: EditorSession): Promise<Record<string, unknown>> {
  const stats = await session.engine.remote.stats().catch(() => null);
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
    engine: session.engine.mode,
    device: session.engine.budget.deviceClass,
    project: session.store.project.settings,
    assets: Object.values(session.store.project.assets).map((a) => ({ name: a.name, codec: a.codec, size: `${a.width}×${a.height}`, fps: a.fps })),
    resources: stats?.resources ?? null,
    memory: stats?.memory ?? null,
    platform: await session.platform().catch(() => null),
  };
}

function row(entry: LogEntry): HTMLElement {
  const time = new Date(entry.time).toLocaleTimeString();
  return h('li', { class: `log-entry ${entry.level}` },
    h('span', { class: 'log-meta' }, `${time} · ${entry.source}${entry.count > 1 ? ` ×${entry.count}` : ''}`),
    h('span', { class: 'log-message' }, entry.message),
  );
}

export function openDiagnostics(session: EditorSession): void {
  const modal = new Modal(t('diagnosticsTitle'));
  const list = h('ol', { class: 'log-list', id: 'log-list' });
  const empty = h('p', { class: 'hint' }, t('diagnosticsEmpty'));
  const render = () => {
    const entries = [...session.log.entries()].reverse();
    list.replaceChildren(...entries.map(row));
    empty.hidden = entries.length > 0;
  };
  const report = async () => session.log.report(await context(session));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await report());
      toast(t('diagnosticsCopied'));
    } catch {
      toast(t('diagnosticsCopyFailed'), 'error');
    }
  };
  const download = async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await saveBlob(new Blob([await report()], { type: 'application/json' }), `montage-log-${stamp}.json`, 'JSON', 'application/json', '.json');
  };
  modal.onClose(session.log.on('entry', render));
  const platform = h('ul', { class: 'platform-notes', id: 'platform-notes' });
  void session.platform().then((report) => {
    const { browser } = report.host;
    const gpu = report.engine.gpu;
    platform.replaceChildren(
      h('li', { class: 'info' }, `${browser.name} ${browser.version ?? ''} · ${browser.os} · ${report.engineMode}${gpu ? ` · ${gpu.renderer}` : ''}`),
      ...platformNotes(report).map((n) => h('li', { class: n.level }, n.message)),
    );
  });
  modal.body(
    h('h4', {}, t('platformTitle')),
    platform,
    h('p', { class: 'hint' }, t('diagnosticsHint')),
    empty,
    list,
    h('div', { class: 'row' },
      h('button', { class: 'btn', id: 'log-clear', onClick: () => { session.log.clear(); render(); } }, t('diagnosticsClear')),
      h('button', { class: 'btn', id: 'log-copy', onClick: () => void copy() }, t('diagnosticsCopy')),
      h('button', { class: 'btn primary', id: 'log-download', onClick: () => void download() }, t('diagnosticsDownload')),
      h('button', { class: 'btn', id: 'log-close', onClick: () => modal.close() }, t('close')),
    ),
  );
  render();
}

export function diagnosticsButton(session: EditorSession): HTMLElement {
  const badge = h('span', { class: 'count', hidden: true });
  const button = h('button', { class: 'btn icon round', id: 'diagnostics', title: t('diagnosticsTitle'), 'aria-label': t('diagnosticsButton'), onClick: () => openDiagnostics(session) }, icon('log'), badge);
  const sync = () => {
    const count = session.log.errorCount;
    badge.hidden = count === 0;
    badge.textContent = String(count);
  };
  session.log.on('entry', sync);
  session.log.on('clear', sync);
  sync();
  return button;
}
