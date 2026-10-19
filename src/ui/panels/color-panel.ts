import type { ColorScience, Item, ParamValue, ParamValues } from '../../core/model';
import { copyEffects, replaceEffect, setAssetColorSpace, setColorScience, setItemColorSpace, upsertEffect } from '../../core/operations';
import { itemColorSpace } from '../../core/model';
import { DEFAULT_INPUT_SPACE, INPUT_SPACES } from '../../effects/color-management';
import { loadGradeVersion, saveGradeVersion } from '../../core/grades';
import { findPlacement, placeTrack } from '../../core/timeline';
import { parseCube } from '../../effects/cube';
import { defaultParams, type ScalarParamSpec } from '../../effects/types';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { CurveEditor } from '../components/curve-editor';
import type { CurvePoints } from '../../effects/curves';
import { Slider } from '../components/slider';
import { toast } from '../components/toast';
import { ColorWheel, type WheelValue } from '../components/wheel';
import { h } from '../dom';
import { iconButton } from '../icons';
import type { Selection } from '../selection';
import { Panel } from './panel';

const SLIDER_PARAMS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation'];
const WHEELS = [
  ['lift', 'shadows'],
  ['gamma', 'midtones'],
  ['gain', 'highlights'],
] as const;

export class ColorPanel extends Panel {
  private hint = h('p', { class: 'hint' }, t('colorHint'));
  private input: HTMLSelectElement;
  private inputClip: HTMLInputElement;
  private science: HTMLSelectElement;
  private version: HTMLSelectElement;
  private sliders = new Map<string, Slider>();
  private wheels = new Map<string, ColorWheel>();
  private lutName = h('div', { class: 'mono' });
  private lutStrength: Slider;
  private curves: CurveEditor;
  private controls: HTMLElement[] = [];

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    super('color', t('colorTitle'));
    const grade = session.registry.filter('grade')!;
    this.input = h('select', { id: 'color-input-space', onChange: () => this.setInputSpace(this.input.value) },
      ...INPUT_SPACES.map((s) => h('option', { value: s.id }, s.label)));
    this.inputClip = h('input', { type: 'checkbox', id: 'color-input-clip', onChange: () => this.setInputSpace(this.input.value) });
    this.science = h('select', { id: 'color-science', onChange: () => session.store.dispatch(setColorScience(this.science.value as ColorScience)) },
      h('option', { value: 'display' }, t('colorScienceDisplay')),
      h('option', { value: 'aces' }, t('colorScienceAces')));

    this.version = h('select', { id: 'grade-version', onChange: () => this.loadVersion(this.version.value) });
    const saveVersion = iconButton('bookmarkPlus', t('versionSave'), { id: 'grade-version-save', onClick: () => this.saveVersion() });

    const wheelRow = h('div', { class: 'wheels' });
    for (const [name, label] of WHEELS) {
      const wheel = new ColorWheel(`wheel-${name}`, t(label), (v) => this.setGrade(name, v));
      this.wheels.set(name, wheel);
      wheelRow.append(wheel.element);
    }

    const sliderBox = h('div', { class: 'group' });
    for (const name of SLIDER_PARAMS) {
      const spec = grade.params.find((p) => p.name === name) as ScalarParamSpec;
      const slider = new Slider({
        id: `grade-${name}`,
        label: spec.label ?? name,
        min: spec.min ?? 0,
        max: spec.max ?? 1,
        step: spec.step ?? 0.01,
        value: Number(spec.default),
        neutral: Number(spec.default),
        onInput: (v) => this.setGrade(name, v),
      });
      this.sliders.set(name, slider);
      sliderBox.append(slider.element);
    }

    const curvesDef = session.registry.filter('curves')!;
    const channelColors: Record<string, string> = { master: '', red: '#e5675a', green: '#5fbf6a', blue: '#5b8def', hueSat: '#e9a23b', hueHue: '#c77dff', hueLum: '#9ad1d4', lumSat: '#d9d9d9', satSat: '#f2c14e' };
    this.curves = new CurveEditor(
      curvesDef.params.map((p) => ({
        name: p.name,
        label: p.label ?? p.name,
        color: channelColors[p.name] ?? '',
        periodic: p.type === 'curve' && !!p.periodic,
        neutral: p.default as CurvePoints,
      })),
      (name, points) => this.setCurve(name, points),
    );

    const lutFile = h('input', { type: 'file', accept: '.cube', hidden: true, onChange: () => void this.loadLut(lutFile) });
    this.lutStrength = new Slider({
      id: 'lut-strength',
      label: 'Strength',
      min: 0,
      max: 1,
      step: 0.01,
      value: 1,
      neutral: 1,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => this.setLut({ strength: v }),
    });
    const loadButton = iconButton('upload', t('lutLoad'), { onClick: () => lutFile.click() });
    const removeButton = iconButton('close', t('lutRemove'), { onClick: () => this.dispatchLut(null) });
    const resetButton = iconButton('reset', t('reset'), { onClick: () => this.reset() });
    const allButton = iconButton('copy', t('applyToAll'), { onClick: () => this.applyToAll() });

    this.controls = [this.input, this.inputClip, loadButton, removeButton, resetButton, allButton];
    this.body.append(
      this.hint,
      h('label', { class: 'field' }, t('colorScience'), this.science),
      h('label', { class: 'field' }, t('colorInputSpace'), this.input),
      h('label', { class: 'check' }, this.inputClip, t('colorInputClipOnly')),
      h('div', { class: 'row' }, h('label', { class: 'field' }, t('versionTitle'), this.version), saveVersion),
      wheelRow,
      sliderBox,
      h('h2', {}, t('curvesTitle')),
      this.curves.element,
      h('p', { class: 'hint' }, t('curvesHint')),
      h('h2', {}, t('lutTitle')),
      this.lutName,
      h('div', { class: 'row' }, loadButton, removeButton, lutFile),
      this.lutStrength.element,
      h('div', { class: 'row' }, resetButton, allButton),
    );
    session.store.on('change', () => this.sync());
    selection.on('change', () => this.sync());
    this.sync();
  }

  private get item(): Item | null {
    const id = this.selection.id;
    return id ? (findPlacement(this.session.store.project, id)?.item ?? null) : null;
  }

  private params(type: string): ParamValues {
    const def = this.session.registry.filter(type)!;
    return { ...defaultParams(def.params), ...this.item?.effects.find((e) => e.type === type)?.params };
  }

  private saveVersion() {
    const item = this.item;
    if (!item) return;
    const name = prompt(t('versionName'), `Version ${Object.keys(item.gradeVersions ?? {}).length + 1}`)?.trim();
    if (name) this.session.store.dispatch(saveGradeVersion(item.id, name));
  }

  private loadVersion(name: string) {
    const item = this.item;
    if (item && name) this.session.store.dispatch(loadGradeVersion(item.id, name));
  }

  private setInputSpace(space: string) {
    const item = this.item;
    if (item?.kind !== 'media') return;
    const { store } = this.session;
    if (this.inputClip.checked) store.dispatch(setItemColorSpace(item.id, space));
    else store.transaction(() => {
      store.dispatch(setItemColorSpace(item.id, null));
      store.dispatch(setAssetColorSpace(item.source.assetId, space));
    });
  }

  private setGrade(name: string, value: ParamValue | WheelValue) {
    const item = this.item;
    if (!item) return;
    this.session.store.dispatch(upsertEffect(item.id, 'grade', { [name]: value as ParamValue }), { coalesce: `grade:${item.id}:${name}` });
  }

  private setCurve(name: string, points: CurvePoints) {
    const item = this.item;
    if (!item) return;
    this.session.store.dispatch(upsertEffect(item.id, 'curves', { [name]: points }), { coalesce: `curves:${item.id}:${name}` });
  }

  private setLut(patch: Record<string, ParamValue>) {
    const item = this.item;
    if (!item || !item.effects.some((e) => e.type === 'lut')) return;
    this.session.store.dispatch(upsertEffect(item.id, 'lut', patch), { coalesce: `lut:${item.id}` });
  }

  private dispatchLut(params: ParamValues | null) {
    const item = this.item;
    if (item) this.session.store.dispatch(replaceEffect(item.id, 'lut', params));
  }

  private async loadLut(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.item) return;
    try {
      const entry = this.session.luts.add(file.name, parseCube(await file.text()));
      this.dispatchLut({ table: entry.id, strength: 1 });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private reset() {
    const item = this.item;
    if (!item) return;
    void this.session.store.transaction(() => {
      this.session.store.dispatch(replaceEffect(item.id, 'grade', null));
      this.session.store.dispatch(replaceEffect(item.id, 'curves', null));
      this.session.store.dispatch(replaceEffect(item.id, 'lut', null));
    });
  }

  private applyToAll() {
    const item = this.item;
    if (!item) return;
    const track = this.session.store.project.tracks.find((tr) => tr.id === this.session.videoTrackId)!;
    const ids = placeTrack(track).map((p) => p.item.id);
    this.session.store.dispatch(copyEffects(item.id, ids));
    toast(t('appliedToAll', { count: ids.length }));
  }

  private sync() {
    const item = this.item;
    this.hint.hidden = !!item;
    this.element.classList.toggle('disabled', !item);
    for (const c of this.controls) (c as HTMLButtonElement).disabled = !item;
    const grade = this.params('grade');
    const asset = item?.kind === 'media' ? this.session.store.project.assets[item.source.assetId] : undefined;
    this.input.value = (item && itemColorSpace(item, this.session.store.project.assets)) ?? DEFAULT_INPUT_SPACE;
    this.input.disabled = !asset;
    this.inputClip.checked = item?.kind === 'media' && !!item.colorSpace;
    this.inputClip.disabled = !asset;
    this.science.value = this.session.store.project.settings?.colorScience ?? 'display';
    const versions = Object.keys(item?.gradeVersions ?? {});
    const options = ['', ...versions];
    if (this.version.options.length !== options.length || options.some((v, i) => this.version.options[i].value !== v))
      this.version.replaceChildren(...options.map((v) => h('option', { value: v }, v || t('versionNone'))));
    this.version.value = item?.gradeVersion && versions.includes(item.gradeVersion) ? item.gradeVersion : '';
    this.version.disabled = !item;
    this.science.disabled = !this.session.store.project.settings;
    for (const [name, slider] of this.sliders) {
      slider.disabled = !item;
      slider.set(Number(grade[name]));
    }
    for (const [name, wheel] of this.wheels) {
      wheel.disabled = !item;
      wheel.set(grade[name] as unknown as WheelValue);
    }
    this.curves.disabled = !item;
    this.curves.set(this.params('curves') as Record<string, CurvePoints>);
    const lut = item?.effects.find((e) => e.type === 'lut');
    const entry = lut ? this.session.luts.get(String(lut.params.table)) : undefined;
    this.lutName.textContent = entry ? `${entry.name} · ${entry.lut.size}³` : t('lutNone');
    this.lutStrength.disabled = !lut;
    this.lutStrength.set(Number(lut?.params.strength ?? 1));
  }
}
