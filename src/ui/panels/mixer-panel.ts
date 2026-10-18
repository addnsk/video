import { MASTER, MAX_DB, MIN_DB, TRIM_LIMIT, addBus, busOutput, mixOf, removeBus, routeBus, routeOf, routeTrack, setSend, setStrip, setStripEffect, stripOf, type Strip } from '../../core/mix';
import { createId } from '../../core/ids';
import { setTrackMuted } from '../../core/operations';
import { LOUDNESS_TARGETS, type LoudnessTarget } from '../../effects/audio/loudness';
import { measureLoudness, normalizeLoudness } from '../../host/loudness';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { Slider } from '../components/slider';
import { toast } from '../components/toast';
import { h } from '../dom';
import { AudioEffectsSection } from './audio-effects-section';

interface StripView {
  readonly id: string;
  readonly element: HTMLElement;
  readonly trim: Slider;
  readonly volume: Slider;
  readonly pan: Slider;
  readonly mute: HTMLInputElement;
  readonly output: HTMLSelectElement | null;
  readonly sends: { bus: string; level: Slider; pre: HTMLInputElement }[];
}

const format = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '−∞');

export class MixerPanel {
  readonly element: HTMLDetailsElement;
  private strips = h('div', { class: 'mixer-strips' });
  private views: StripView[] = [];
  private structure = '';
  private editing = MASTER;
  private effects: AudioEffectsSection;
  private effectsTitle = h('h3', {});
  private reading = h('p', { class: 'hint', id: 'loudness-reading' });

  constructor(private session: EditorSession) {
    const { store } = session;
    this.effects = new AudioEffectsSection(store, 'strip', '');
    this.effects.element.querySelector('h3')!.replaceWith(this.effectsTitle);
    const addBusButton = h('button', { class: 'btn small', id: 'mixer-add-bus', onClick: () => store.dispatch(addBus(t('mixerBusName', { n: mixOf(store.project).buses.length + 1 }), createId('bus'))) }, t('mixerAddBus'));
    const target = h('select', { id: 'loudness-target', 'aria-label': t('loudnessTarget') },
      ...Object.entries(LOUDNESS_TARGETS).map(([id, v]) => h('option', { value: id }, `${id} (${v.integrated} LUFS)`)));
    const measure = h('button', { class: 'btn small', id: 'loudness-measure', onClick: () => void this.measure() }, t('loudnessMeasure'));
    const normalize = h('button', { class: 'btn small', id: 'loudness-normalize', onClick: () => void this.normalize(target.value as LoudnessTarget) }, t('loudnessNormalize'));
    this.element = h('details', { class: 'panel mixer', id: 'mixer' },
      h('summary', {}, h('h2', {}, t('mixerTitle'))),
      this.strips,
      addBusButton,
      this.effects.element,
      h('div', { class: 'group loudness' }, h('h3', {}, t('loudnessTitle')), h('div', { class: 'row' }, target, measure, normalize), this.reading),
    );
    store.on('change', () => this.sync());
    this.sync();
  }

  private async measure() {
    this.reading.textContent = t('loudnessMeasuring');
    try {
      const r = await measureLoudness(this.session);
      this.reading.textContent = t('loudnessResult', { integrated: format(r.integrated), range: format(r.range), peak: format(r.peak) });
    } catch (e) {
      this.reading.textContent = '';
      toast((e as Error).message, 'error');
    }
  }

  private async normalize(target: LoudnessTarget) {
    this.reading.textContent = t('loudnessMeasuring');
    try {
      const result = await normalizeLoudness(this.session, target);
      this.reading.textContent = t('loudnessNormalized', { gain: format(result.gain), limiter: result.limiter ? t('loudnessLimiter') : '' });
    } catch (e) {
      this.reading.textContent = '';
      toast((e as Error).message, 'error');
    }
  }

  private targets(): { id: string; name: string; kind: 'track' | 'bus' | 'master' }[] {
    const project = this.session.store.project;
    const mix = mixOf(project);
    return [
      ...project.tracks.map((tr) => ({ id: tr.id, name: tr.id, kind: 'track' as const })),
      ...mix.buses.map((b) => ({ id: b.id, name: b.name, kind: 'bus' as const })),
      { id: MASTER, name: t('mixerMaster'), kind: 'master' as const },
    ];
  }

  private sync() {
    const project = this.session.store.project;
    const targets = this.targets();
    const structure = JSON.stringify([targets, mixOf(project).buses.map((b) => b.id)]);
    if (structure !== this.structure) {
      this.structure = structure;
      this.views = targets.map((target) => this.view(target.id, target.name, target.kind));
      this.strips.replaceChildren(...this.views.map((v) => v.element));
      if (!stripOf(project, this.editing)) this.editing = MASTER;
    }
    for (const view of this.views) {
      const strip = stripOf(project, view.id);
      if (!strip) continue;
      view.trim.set(strip.trim ?? 0);
      view.volume.set(strip.volume);
      view.pan.set(strip.pan);
      const track = project.tracks.find((tr) => tr.id === view.id);
      view.mute.checked = track ? track.muted : strip.mute;
      const mix = mixOf(project);
      const bus = mix.buses.find((b) => b.id === view.id);
      if (view.output) view.output.value = bus ? busOutput(mix, bus) : routeOf(project, view.id).output;
      const sends = track ? routeOf(project, view.id).sends ?? [] : [];
      for (const send of view.sends) {
        const current = sends.find((x) => x.bus === send.bus);
        send.level.set(current?.level ?? MIN_DB);
        send.pre.checked = current?.pre ?? false;
      }
      view.element.classList.toggle('editing', view.id === this.editing);
    }
    const editing = stripOf(project, this.editing)!;
    this.effectsTitle.textContent = t('mixerStripEffects', { name: this.targets().find((x) => x.id === this.editing)?.name ?? this.editing });
    this.effects.bind({ key: this.editing, set: (type, params) => setStripEffect(this.editing, type, params) }, editing.effects);
  }

  private view(id: string, name: string, kind: 'track' | 'bus' | 'master'): StripView {
    const { store } = this.session;
    const project = store.project;
    const strip: Strip = stripOf(project, id)!;
    const trim = new Slider({
      id: `mixer-${id}-trim`, label: t('mixerTrim'), min: -TRIM_LIMIT, max: TRIM_LIMIT, step: 0.5, value: strip.trim ?? 0, neutral: 0,
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
      onInput: (v) => store.dispatch(setStrip(id, { trim: v }), { coalesce: `mixer:${id}:trim` }),
    });
    const volume = new Slider({
      id: `mixer-${id}-volume`, label: t('mixerVolume'), min: MIN_DB, max: MAX_DB, step: 0.5, value: strip.volume, neutral: 0,
      format: (v) => (v <= MIN_DB ? '−∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
      onInput: (v) => store.dispatch(setStrip(id, { volume: v }), { coalesce: `mixer:${id}:volume` }),
    });
    const pan = new Slider({
      id: `mixer-${id}-pan`, label: t('mixerPan'), min: -1, max: 1, step: 0.05, value: strip.pan, neutral: 0,
      format: (v) => (Math.abs(v) < 0.001 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`),
      onInput: (v) => store.dispatch(setStrip(id, { pan: v }), { coalesce: `mixer:${id}:pan` }),
    });
    const mute = h('input', { type: 'checkbox', id: `mixer-${id}-mute` });
    mute.addEventListener('change', () => store.dispatch(kind === 'track' ? setTrackMuted(id, mute.checked) : setStrip(id, { mute: mute.checked })));
    let output: HTMLSelectElement | null = null;
    const buses = mixOf(project).buses;
    if (kind !== 'master') {
      output = h('select', { id: `mixer-${id}-output`, 'aria-label': t('mixerOutput') },
        h('option', { value: MASTER }, t('mixerMaster')),
        ...buses.filter((b) => b.id !== id).map((b) => h('option', { value: b.id }, b.name)));
      const select = output;
      select.addEventListener('change', () => {
        try {
          store.dispatch(kind === 'bus' ? routeBus(id, select.value) : routeTrack(id, select.value));
        } catch (e) {
          toast((e as Error).message, 'error');
          this.sync();
        }
      });
    }
    const sends = kind === 'track'
      ? buses.map((b) => {
          const pre = h('input', { type: 'checkbox', id: `mixer-${id}-send-${b.id}-pre` });
          const level = new Slider({
            id: `mixer-${id}-send-${b.id}`, label: t('mixerSend', { name: b.name }), min: MIN_DB, max: MAX_DB, step: 0.5, value: MIN_DB, neutral: MIN_DB,
            format: (v) => (v <= MIN_DB ? t('mixerSendOff') : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
            onInput: (v) => store.dispatch(setSend(id, b.id, v <= MIN_DB ? null : v, pre.checked), { coalesce: `mixer:${id}:send:${b.id}` }),
          });
          pre.addEventListener('change', () => {
            const current = routeOf(store.project, id).sends?.find((x) => x.bus === b.id);
            if (current) store.dispatch(setSend(id, b.id, current.level, pre.checked));
          });
          return { bus: b.id, level, pre };
        })
      : [];
    const edit = h('button', { class: 'btn small', id: `mixer-${id}-edit`, onClick: () => { this.editing = id; this.sync(); } }, t('mixerEdit'));
    const remove = kind === 'bus' ? h('button', { class: 'btn small', id: `mixer-${id}-remove`, onClick: () => store.dispatch(removeBus(id)) }, t('mixerRemoveBus')) : null;
    const element = h('div', { class: `mixer-strip ${kind}`, id: `mixer-${id}` },
      h('div', { class: 'row' }, h('strong', {}, name), h('label', {}, mute, t('mixerMute')), output, edit, remove),
      trim.element,
      volume.element,
      pan.element,
      ...sends.map((x) => h('div', { class: 'send' }, x.level.element, h('label', {}, x.pre, t('mixerPreFader')))),
    );
    return { id, element, trim, volume, pan, mute, output, sends };
  }
}
