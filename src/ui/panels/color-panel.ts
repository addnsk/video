import type { Item, ParamValue, ParamValues } from '../../core/model';
import { copyEffects, replaceEffect, upsertEffect } from '../../core/operations';
import { findPlacement, placeTrack } from '../../core/timeline';
import { parseCube } from '../../effects/cube';
import { defaultParams, type EnumParamSpec, type ScalarParamSpec } from '../../effects/types';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { Slider } from '../components/slider';
import { toast } from '../components/toast';
import { ColorWheel, type WheelValue } from '../components/wheel';
import { h } from '../dom';
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
  private sliders = new Map<string, Slider>();
  private wheels = new Map<string, ColorWheel>();
  private lutName = h('div', { class: 'mono' });
  private lutStrength: Slider;
  private controls: HTMLElement[] = [];

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    super('color', t('colorTitle'));
    const grade = session.registry.filter('grade')!;
    const inputSpec = grade.params.find((p) => p.name === 'inputTransform') as EnumParamSpec;
    this.input = h('select', { id: 'grade-input', onChange: () => this.setGrade('inputTransform', this.input.value) },
      ...inputSpec.options.map((o) => h('option', { value: o.value }, o.label)));

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
    const loadButton = h('button', { class: 'btn', onClick: () => lutFile.click() }, t('lutLoad'));
    const removeButton = h('button', { class: 'btn', onClick: () => this.dispatchLut(null) }, t('lutRemove'));
    const resetButton = h('button', { class: 'btn', onClick: () => this.reset() }, t('reset'));
    const allButton = h('button', { class: 'btn', onClick: () => this.applyToAll() }, t('applyToAll'));

    this.controls = [this.input, loadButton, removeButton, resetButton, allButton];
    this.body.append(
      this.hint,
      h('label', { class: 'field' }, inputSpec.label ?? '', this.input),
      wheelRow,
      sliderBox,
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

  private setGrade(name: string, value: ParamValue | WheelValue) {
    const item = this.item;
    if (!item) return;
    this.session.store.dispatch(upsertEffect(item.id, 'grade', { [name]: value as ParamValue }), { coalesce: `grade:${item.id}:${name}` });
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
    this.input.value = String(grade.inputTransform);
    for (const [name, slider] of this.sliders) {
      slider.disabled = !item;
      slider.set(Number(grade[name]));
    }
    for (const [name, wheel] of this.wheels) {
      wheel.disabled = !item;
      wheel.set(grade[name] as unknown as WheelValue);
    }
    const lut = item?.effects.find((e) => e.type === 'lut');
    const entry = lut ? this.session.luts.get(String(lut.params.table)) : undefined;
    this.lutName.textContent = entry ? `${entry.name} · ${entry.lut.size}³` : t('lutNone');
    this.lutStrength.disabled = !lut;
    this.lutStrength.set(Number(lut?.params.strength ?? 1));
  }
}
