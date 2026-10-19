import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { languageSelect } from './components/language-select';
import { Modal } from './components/modal';
import { openDiagnostics } from './diagnostics-dialog';
import { h } from './dom';
import { icon } from './icons';
import { LAYOUT_EVENT, LAYOUT_KEY, type LayoutMode } from './react/workspace';

function readLayout(): LayoutMode {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '"wide"') === 'classic' ? 'classic' : 'wide';
  } catch {
    return 'wide';
  }
}

function writeLayout(mode: LayoutMode) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(mode));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

function resetPanelSizes() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('montage.split.')) localStorage.removeItem(key);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
  location.reload();
}

export function openSettings(session: EditorSession): void {
  const modal = new Modal(t('settingsTitle'));
  const layout = h('div', { class: 'segmented', role: 'radiogroup', id: 'settings-layout', 'aria-label': t('settingsLayout') });
  const options: { mode: LayoutMode; label: string }[] = [
    { mode: 'wide', label: t('settingsLayoutWide') },
    { mode: 'classic', label: t('settingsLayoutClassic') },
  ];
  const renderLayout = () => layout.replaceChildren(...options.map(({ mode, label }) => h('button', {
    type: 'button',
    class: 'seg',
    role: 'radio',
    id: `settings-layout-${mode}`,
    'aria-checked': String(readLayout() === mode),
    onClick: () => {
      writeLayout(mode);
      renderLayout();
    },
  }, label)));
  renderLayout();
  const errors = session.log.errorCount;
  const row = (label: string, control: Node) => h('div', { class: 'settings-row' }, h('span', {}, label), control);
  modal.body(
    row(t('language'), languageSelect()),
    row(t('settingsLayout'), layout),
    row(t('settingsPanels'), h('button', { class: 'btn', id: 'settings-reset-panels', onClick: resetPanelSizes }, t('settingsResetPanels'))),
    row(t('diagnosticsTitle'), h('button', { class: 'btn', id: 'diagnostics', onClick: () => {
      modal.close();
      openDiagnostics(session);
    } }, icon('log', 16), h('span', {}, t('diagnosticsButton')), errors ? h('span', { class: 'count' }, String(errors)) : null)),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', id: 'settings-close', onClick: () => modal.close() }, t('close'))),
  );
}

export function settingsButton(session: EditorSession): HTMLButtonElement {
  const badge = h('span', { class: 'count', hidden: true });
  const button = h('button', { class: 'btn icon ghost', id: 'settings-open', title: t('settingsTitle'), 'aria-label': t('settingsTitle'), onClick: () => openSettings(session) }, icon('gear', 19), badge);
  const sync = () => {
    badge.hidden = session.log.errorCount === 0;
    badge.textContent = String(session.log.errorCount);
  };
  session.log.on('entry', sync);
  session.log.on('clear', sync);
  sync();
  return button;
}
