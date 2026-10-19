import type { MontageApi } from '../api/montage';
import { INTERCHANGE_FORMATS } from '../core/interchange';
import { INTERCHANGE_TYPES, pickFiles, saveBlob } from '../host/file-picker';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { toast } from './components/toast';
import { h } from './dom';
import type { Selection } from './selection';

export class TimelineSwitcher {
  readonly element: HTMLElement;
  private select: HTMLSelectElement;

  constructor(
    private session: EditorSession,
    private selection: Selection,
    private api: MontageApi,
  ) {
    this.select = h('select', { id: 'timeline-select', 'aria-label': t('timelineSelect'), onChange: () => this.attempt(() => this.api.timelines.open(this.select.value)) });
    const button = (id: string, label: string, run: () => void) => h('button', { class: 'btn small', id, onClick: () => this.attempt(run) }, label);
    const menu = h('div', { class: 'menu-list' },
      button('timeline-new', t('timelineNew'), () => this.api.timelines.create()),
      button('timeline-rename', t('timelineRename'), () => {
        const active = this.api.timelines.active();
        const name = prompt(t('timelineRenamePrompt'), active.name);
        if (name) this.api.timelines.rename(active.id, name);
      }),
      button('timeline-format', t('timelineFormat'), () => {
        const current = this.api.timelines.format();
        const answer = prompt(t('timelineFormatPrompt'), current ? `${current.width}x${current.height}@${+current.fps.toFixed(3)}` : '1920x1080@25');
        if (!answer) return;
        const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/i.exec(answer);
        if (!match) throw new Error(t('timelineFormatInvalid'));
        this.api.timelines.format({ width: Number(match[1]), height: Number(match[2]), ...(match[3] ? { fps: Number(match[3]) } : {}) });
      }),
      button('timeline-duplicate', t('timelineDuplicate'), () => this.api.timelines.open(this.api.timelines.duplicate())),
      button('timeline-delete', t('timelineDelete'), () => {
        const others = this.api.timelines.list().filter((x) => !x.active);
        if (!others.length) throw new Error(t('timelineLast'));
        const active = this.api.timelines.active();
        if (!confirm(t('timelineDeleteConfirm', { name: active.name }))) return;
        this.api.timelines.open(others[0].id);
        this.api.timelines.remove(active.id);
      }),
      ...(['otio', 'fcpxml', 'edl'] as const).map((format) => button(`timeline-export-${format}`, t('timelineExportAs', { format: format.toUpperCase() }), () => {
        const { extension, mime } = INTERCHANGE_FORMATS[format];
        const text = this.api.interchange.export(format);
        const name = `${this.api.timelines.active().name}.${extension}`;
        void saveBlob(new Blob([text], { type: mime }), name, format.toUpperCase(), mime, `.${extension}`);
      })),
      button('timeline-import', t('timelineImport'), () => void this.importTimeline()),
      button('compound-clip', t('compoundClip'), () => {
        if (!this.selection.id) throw new Error(t('compoundNeedsSelection'));
        const name = prompt(t('compoundPrompt'), t('compoundDefault'));
        if (name === null) return;
        const result = this.api.timelines.compound([this.selection.id], name || undefined);
        this.selection.set(result.clip);
      }),
    );
    const details = h('details', { class: 'menu' }, h('summary', { class: 'btn small', id: 'timeline-menu', 'aria-label': t('timelineMenu') }, '⋯'), menu);
    menu.addEventListener('click', () => details.removeAttribute('open'));
    this.element = h('div', { class: 'timeline-switcher' }, this.select, details);
    session.store.on('change', ({ project, previous }) => {
      if (project.timeline !== previous.timeline || project.timelines !== previous.timelines) this.render();
    });
    this.render();
  }

  private async importTimeline() {
    const [picked] = await pickFiles({ ...INTERCHANGE_TYPES, multiple: false });
    if (!picked) return;
    try {
      const result = this.api.interchange.import(await picked.file.text(), { fileName: picked.file.name });
      toast(result.placeholders.length ? t('timelineImportedOffline', { count: result.placeholders.length }) : t('timelineImported'));
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  private attempt(run: () => void) {
    try {
      run();
    } catch (error) {
      toast((error as Error).message, 'error');
      this.render();
    }
  }

  private render() {
    const list = this.api.timelines.list();
    this.select.replaceChildren(...list.map((x) => h('option', { value: x.id, selected: x.active }, x.name)));
  }
}
