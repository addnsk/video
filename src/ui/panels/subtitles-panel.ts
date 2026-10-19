import type { MontageApi } from '../../api/montage';
import type { SubtitleTrack } from '../../core/model';
import { pickFiles, saveBlob } from '../../host/file-picker';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { toast } from '../components/toast';
import { formatTimecode, h } from '../dom';
import { Panel } from './panel';

const SUBTITLE_TYPES = { description: 'Subtitles', mime: 'text/plain', extensions: ['.srt', '.vtt'] };

export class SubtitlesPanel extends Panel {
  private selected: string | null = null;

  constructor(
    private session: EditorSession,
    private api: MontageApi,
  ) {
    super('subtitles', t('subtitlesTitle'));
    session.store.on('change', ({ project, previous }) => {
      if (project.subtitles !== previous.subtitles || project.timeline !== previous.timeline) this.schedule();
    });
    this.render();
  }

  private attempt(run: () => unknown) {
    try {
      const result = run();
      if (result instanceof Promise) result.catch((e: Error) => toast(e.message, 'error'));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private async importFile() {
    const [picked] = await pickFiles({ ...SUBTITLE_TYPES, multiple: false });
    if (!picked) return;
    const name = picked.file.name.replace(/\.[^.]+$/, '');
    this.selected = this.api.subtitles.import(await picked.file.text(), { name });
    toast(t('subtitlesImported', { count: this.api.subtitles.cues(this.selected).length }));
    this.render();
  }

  private save(track: SubtitleTrack, format: 'srt' | 'vtt') {
    const text = this.api.subtitles.export(track.id, format);
    void saveBlob(new Blob([text], { type: 'text/plain' }), `${track.name}.${format}`, format.toUpperCase(), format === 'vtt' ? 'text/vtt' : 'application/x-subrip', `.${format}`);
  }

  protected render() {
    const tracks = this.session.store.project.subtitles ?? [];
    const track = tracks.find((x) => x.id === this.selected) ?? tracks[0] ?? null;
    this.selected = track?.id ?? null;
    const head = h('div', { class: 'row wrap' },
      h('select', { id: 'subtitle-track', 'aria-label': t('subtitlesTrack'), disabled: !tracks.length, onChange: (e: Event) => {
        this.selected = (e.target as HTMLSelectElement).value;
        this.render();
      } }, ...tracks.map((x) => h('option', { value: x.id, selected: x === track }, x.name))),
      h('button', { class: 'btn small', id: 'subtitle-new', onClick: () => this.attempt(() => {
        this.selected = this.api.subtitles.add();
        this.render();
      }) }, t('subtitlesNew')),
      h('button', { class: 'btn small', id: 'subtitle-import', onClick: () => this.attempt(() => this.importFile()) }, t('subtitlesImport')),
    );
    if (!track) {
      this.body.replaceChildren(head, h('p', { class: 'hint' }, t('subtitlesEmpty')));
      return;
    }
    const fps = this.session.store.project.settings?.fps ?? 25;
    const style = (patch: Partial<SubtitleTrack['style']>) => this.attempt(() => this.api.subtitles.style(track.id, patch));
    const check = (id: string, label: string, value: boolean, set: (v: boolean) => void) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: value, onChange: (e: Event) => this.attempt(() => set((e.target as HTMLInputElement).checked)) }), label);
    const options = h('div', { class: 'row wrap' },
      check('subtitle-burn', t('subtitlesBurnIn'), track.burnIn, (v) => this.api.subtitles.update(track.id, { burnIn: v })),
      check('subtitle-visible', t('subtitlesVisible'), track.visible, (v) => this.api.subtitles.update(track.id, { visible: v })),
      h('button', { class: 'btn small', id: 'subtitle-export-srt', onClick: () => this.save(track, 'srt') }, 'SRT'),
      h('button', { class: 'btn small', id: 'subtitle-export-vtt', onClick: () => this.save(track, 'vtt') }, 'VTT'),
      h('button', { class: 'btn small', id: 'subtitle-delete', 'aria-label': t('subtitlesDelete'), onClick: () => this.attempt(() => {
        if (!confirm(t('subtitlesDeleteConfirm', { name: track.name }))) return;
        this.api.subtitles.remove(track.id);
      }) }, '×'),
    );
    const styleRow = h('div', { class: 'subtitle-style' },
      h('label', { class: 'field' }, t('subtitlesName'), h('input', { type: 'text', id: 'subtitle-name', value: track.name, onChange: (e: Event) => this.attempt(() => this.api.subtitles.update(track.id, { name: (e.target as HTMLInputElement).value })) })),
      h('label', { class: 'field' }, t('subtitlesSize'), h('input', { type: 'range', id: 'subtitle-size', min: 0.02, max: 0.15, step: 0.005, value: track.style.size, onChange: (e: Event) => style({ size: +(e.target as HTMLInputElement).value }) })),
      h('label', { class: 'field' }, t('subtitlesPosition'), h('input', { type: 'range', id: 'subtitle-position', min: 0, max: 0.9, step: 0.01, value: track.style.position, onChange: (e: Event) => style({ position: +(e.target as HTMLInputElement).value }) })),
      h('label', { class: 'field' }, t('subtitlesColor'), h('input', { type: 'color', id: 'subtitle-color', value: track.style.color.slice(0, 7), onChange: (e: Event) => style({ color: (e.target as HTMLInputElement).value }) })),
      h('label', { class: 'field' }, t('subtitlesOutline'), h('input', { type: 'color', id: 'subtitle-outline', value: (track.style.outline ?? '#000000').slice(0, 7), onChange: (e: Event) => style({ outline: (e.target as HTMLInputElement).value }) })),
      check('subtitle-box', t('subtitlesBox'), !!track.style.background, (v) => style({ background: v ? '#000000b0' : null })),
    );
    const add = h('button', { class: 'btn small', id: 'subtitle-add', onClick: () => this.attempt(() => this.api.subtitles.addCue(track.id, { text: t('subtitlesNewCue') })) }, t('subtitlesAdd'));
    const rows = track.cues.map((cue) => {
      const time = (key: 'start' | 'end', value: number) =>
        h('input', { type: 'number', step: 0.01, min: 0, value: +value.toFixed(3), 'data-field': key, 'aria-label': t(key === 'start' ? 'subtitlesStart' : 'subtitlesEnd'), onChange: (e: Event) => this.attempt(() => this.api.subtitles.updateCue(track.id, cue.id, { [key]: +(e.target as HTMLInputElement).value })) });
      return h('div', { class: 'cue-row', 'data-cue': cue.id },
        h('button', { class: 'btn small tc-link', onClick: () => this.session.transport.seek(cue.start) }, formatTimecode(cue.start, fps)),
        time('start', cue.start),
        time('end', cue.end),
        h('textarea', { rows: 2, 'data-field': 'text', 'aria-label': t('subtitlesText'), onChange: (e: Event) => this.attempt(() => this.api.subtitles.updateCue(track.id, cue.id, { text: (e.target as HTMLTextAreaElement).value })) }, cue.text),
        h('button', { class: 'btn small', 'aria-label': t('subtitlesRemoveCue'), onClick: () => this.attempt(() => this.api.subtitles.removeCue(track.id, cue.id)) }, '×'),
      );
    });
    this.body.replaceChildren(head, options, styleRow, add, h('div', { class: 'cue-list' }, ...rows));
  }
}

export function subtitleOverlay(session: EditorSession, canvas: HTMLElement): HTMLElement {
  const overlay = h('div', { class: 'subtitle-overlay', 'aria-live': 'polite', hidden: true });
  let last = '';
  let size = 0;
  let bottom = 0;
  const place = () => {
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    Object.assign(overlay.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${width}px`, height: `${height}px`, fontSize: `${size * height}px`, paddingBottom: `${bottom * height}px` });
  };
  new ResizeObserver(place).observe(canvas);
  const update = () => {
    const time = session.transport.time;
    const parts: string[] = [];
    size = 0;
    bottom = 0;
    let css = '';
    for (const track of session.store.project.subtitles ?? []) {
      if (!track.visible || track.burnIn) continue;
      const cues = track.cues.filter((c) => time >= c.start && time < c.end);
      if (!cues.length) continue;
      parts.push(cues.map((c) => c.text).join('\n'));
      const s = track.style;
      size ||= s.size;
      bottom ||= s.position;
      const outline = s.outline && s.outlineWidth ? `--outline:${s.outline};` : '';
      css ||= `--width:${s.maxWidth * 100}%;color:${s.color};${outline}${s.background ? `--box:${s.background};` : ''}font-family:"${s.font}",sans-serif;font-weight:${s.weight}`;
    }
    const key = parts.join('\n') + css;
    if (key === last) return;
    last = key;
    overlay.hidden = !parts.length;
    overlay.setAttribute('style', css);
    place();
    overlay.replaceChildren(...parts.map((p) => h('span', {}, p)));
  };
  session.transport.on('time', update);
  session.store.on('change', update);
  update();
  return overlay;
}
