import type { MontageApi } from '../api/montage';
import { Emitter } from '../core/emitter';
import type { EditorSession } from '../host/session';
import type { Transport } from '../host/transport';
import { t } from '../i18n';
import { toast } from './components/toast';
import { h } from './dom';
import type { Selection } from './selection';

export type TrimTool = 'select' | 'ripple' | 'roll' | 'slip' | 'slide';

const TOOLS: readonly { tool: TrimTool; key: string }[] = [
  { tool: 'select', key: 'KeyA' },
  { tool: 'ripple', key: 'KeyT' },
  { tool: 'roll', key: 'KeyR' },
  { tool: 'slip', key: 'KeyY' },
  { tool: 'slide', key: 'KeyU' },
];

export class EditControls extends Emitter<{ tool: TrimTool }> {
  readonly viewerTabs: HTMLElement;
  readonly editBar: HTMLElement;
  readonly toolBar: HTMLElement;
  private current: TrimTool = 'select';
  private sourceTab: HTMLButtonElement;
  private timelineTab: HTMLButtonElement;
  private editButtons: HTMLButtonElement[];
  private toolButtons = new Map<TrimTool, HTMLButtonElement>();

  constructor(
    private session: EditorSession,
    private selection: Selection,
    private api: MontageApi,
  ) {
    super();
    const { source } = session;
    this.timelineTab = h('button', { class: 'seg', id: 'viewer-timeline', onClick: () => source.show('timeline') }, t('viewerTimeline'));
    this.sourceTab = h('button', { class: 'seg', id: 'viewer-source', onClick: () => source.show('source') }, t('viewerSource'));
    this.editButtons = [
      h('button', { class: 'btn small', id: 'mark-in', title: 'I', onClick: () => this.mark('in') }, t('markIn')),
      h('button', { class: 'btn small', id: 'mark-out', title: 'O', onClick: () => this.mark('out') }, t('markOut')),
      h('button', { class: 'btn small', id: 'edit-insert', title: 'F9', onClick: () => this.edit('insert') }, t('editInsert')),
      h('button', { class: 'btn small', id: 'edit-overwrite', title: 'F10', onClick: () => this.edit('overwrite') }, t('editOverwrite')),
      h('button', { class: 'btn small', id: 'edit-append', title: 'Shift+F12', onClick: () => this.edit('append') }, t('editAppend')),
      h('button', { class: 'btn small', id: 'add-marker', title: 'M', onClick: () => this.addMarker() }, t('addMarker')),
    ];
    this.viewerTabs = h('div', { class: 'segmented viewer-tabs', role: 'tablist' }, this.timelineTab, this.sourceTab);
    this.editBar = h('div', { class: 'edit-bar' }, ...this.editButtons);
    this.toolBar = h('div', { class: 'segmented', id: 'trim-tools', role: 'radiogroup', 'aria-label': t('trimTools') });
    for (const { tool, key } of TOOLS) {
      const button = h('button', { class: 'seg', role: 'radio', id: `tool-${tool}`, title: key.slice(3), onClick: () => (this.tool = tool) }, t(`tool_${tool}` as const));
      this.toolButtons.set(tool, button);
      this.toolBar.append(button);
    }
    source.on('change', () => this.sync());
    session.store.on('change', () => this.sync());
    this.sync();
  }

  get tool(): TrimTool {
    return this.current;
  }

  set tool(tool: TrimTool) {
    if (tool === this.current) return;
    this.current = tool;
    this.sync();
    this.emit('tool', tool);
  }

  get active(): Transport {
    return this.session.source.viewer === 'source' ? this.session.source.transport : this.session.transport;
  }

  private sync() {
    const { source, store } = this.session;
    const name = source.assetId ? store.project.assets[source.assetId]?.name : null;
    this.sourceTab.textContent = name ? `${t('viewerSource')}: ${name}` : t('viewerSource');
    this.sourceTab.disabled = !source.assetId;
    this.timelineTab.setAttribute('aria-selected', String(source.viewer === 'timeline'));
    this.sourceTab.setAttribute('aria-selected', String(source.viewer === 'source'));
    const canEdit = !!source.assetId;
    for (const id of ['edit-insert', 'edit-overwrite', 'edit-append']) this.editButtons.find((b) => b.id === id)!.disabled = !canEdit;
    for (const [tool, button] of this.toolButtons) button.setAttribute('aria-checked', String(tool === this.current));
  }

  private attempt(fn: () => void) {
    try {
      fn();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  mark(edge: 'in' | 'out', value: number | null = this.active.time) {
    this.attempt(() => {
      if (this.session.source.viewer === 'source') this.api.source.mark({ [edge]: value });
      else this.api.marks({ [edge]: value });
    });
  }

  clearMarks() {
    this.attempt(() => {
      if (this.session.source.viewer === 'source') this.api.source.mark({ in: null, out: null });
      else this.api.marks({ in: null, out: null });
    });
  }

  edit(mode: 'insert' | 'overwrite' | 'append') {
    this.attempt(() => {
      const result = this.api.edit[mode]();
      this.api.marks({ in: null, out: null });
      this.selection.set(result.video ?? result.audio);
      this.session.source.show('timeline');
      this.session.transport.seek(result.start + result.duration);
    });
  }

  addMarker() {
    this.attempt(() => void this.api.markers.add({ time: this.session.transport.time }));
  }

  jumpMarker(direction: 1 | -1) {
    const marker = direction > 0 ? this.api.markers.next() : this.api.markers.previous();
    if (marker) this.session.transport.seek(marker.time);
  }

  deleteSelection(ripple: boolean) {
    const id = this.selection.id;
    if (id) this.attempt(() => this.api.edit.delete(id, { ripple }));
  }

  toggleLink() {
    const id = this.selection.id;
    if (!id) return;
    this.attempt(() => {
      if (this.api.edit.linked(id).length > 1) this.api.edit.unlink(id);
      else {
        const clip = this.api.clip(id);
        const partner = this.session.store.project.tracks
          .filter((tr) => tr.id !== clip.track)
          .flatMap((tr) => this.api.clips(tr.id))
          .find((c) => Math.abs(c.start - clip.start) < 1e-3 && c.assetId === clip.assetId);
        if (!partner) throw new Error(t('linkNoPartner'));
        this.api.edit.link([id, partner.id]);
      }
    });
  }

  nudge(frames: number) {
    const id = this.selection.id;
    if (!id) return;
    const step = frames / (this.session.store.project.settings?.fps ?? 25);
    this.attempt(() => {
      if (this.current === 'slide') this.api.edit.slide(id, step);
      else this.api.edit.slip(id, step);
    });
  }

  cutAngle(angle: number, videoOnly: boolean) {
    this.attempt(() => this.api.multicam.cut(angle, videoOnly ? { only: 'video' } : {}));
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey && e.code === 'KeyL') this.toggleLink();
      else return false;
      return true;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && !e.shiftKey && this.session.source.viewer === 'timeline') this.cutAngle(Number(digit[1]) - 1, e.altKey);
    else if (e.altKey && e.code === 'KeyX') this.clearMarks();
    else if (e.altKey) return false;
    else if (e.code === 'KeyI') this.mark('in');
    else if (e.code === 'KeyO') this.mark('out');
    else if (e.code === 'F9') this.edit('insert');
    else if (e.code === 'F10') this.edit('overwrite');
    else if (e.code === 'F12' && e.shiftKey) this.edit('append');
    else if (e.code === 'KeyM') this.addMarker();
    else if (e.shiftKey && e.code === 'ArrowUp') this.jumpMarker(-1);
    else if (e.shiftKey && e.code === 'ArrowDown') this.jumpMarker(1);
    else if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) this.deleteSelection(true);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection(false);
    else if (e.code === 'Comma' && (this.current === 'slip' || this.current === 'slide')) this.nudge(e.shiftKey ? -5 : -1);
    else if (e.code === 'Period' && (this.current === 'slip' || this.current === 'slide')) this.nudge(e.shiftKey ? 5 : 1);
    else {
      const tool = TOOLS.find((x) => x.key === e.code && !e.shiftKey);
      if (!tool) return false;
      this.tool = tool.tool;
    }
    return true;
  }
}
