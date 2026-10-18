import type { EffectInstance, Item, ParamValues } from '../../core/model';
import { replaceEffect, upsertEffect, type Operation } from '../../core/operations';
import { AUDIO_EFFECTS } from '../../effects/audio/builtin';
import { numberParam, type AudioEffectDef } from '../../effects/audio/types';
import type { Store } from '../../core/store';
import { t } from '../../i18n';
import { Slider } from '../components/slider';
import { h } from '../dom';

export interface EffectsBinding {
  readonly key: string;
  set(type: string, params: ParamValues | null): Operation;
}

interface Row {
  def: AudioEffectDef;
  element: HTMLDetailsElement;
  sliders: Map<string, Slider>;
}

export const itemEffects = (itemId: string): EffectsBinding => ({
  key: itemId,
  set: (type, params) => (params ? upsertEffect(itemId, type, params) : replaceEffect(itemId, type, null)),
});

export class AudioEffectsSection {
  readonly element: HTMLDivElement;
  private rows: Row[];
  private binding: EffectsBinding | null = null;

  constructor(
    private store: Store,
    private prefix = 'audio',
    title: string = t('audioEffects'),
  ) {
    this.rows = AUDIO_EFFECTS.map((def) => this.row(def));
    this.element = h('div', { class: 'group audio-effects' }, h('h3', {}, title), ...this.rows.map((r) => r.element));
  }

  private row(def: AudioEffectDef): Row {
    const sliders = new Map<string, Slider>();
    for (const spec of def.params) {
      sliders.set(spec.name, new Slider({
        id: `${this.prefix}-${def.id}-${spec.name}`,
        label: spec.label ?? spec.name,
        min: spec.min ?? 0,
        max: spec.max ?? 1,
        step: spec.step ?? 0.01,
        value: Number(spec.default),
        neutral: Number(spec.default),
        format: (v) => `${+v.toFixed(1)}`,
        onInput: (value) => {
          const binding = this.binding;
          if (binding) this.store.dispatch(binding.set(def.id, { [spec.name]: value }), { coalesce: `${this.prefix}:${binding.key}:${def.id}:${spec.name}` });
        },
      }));
    }
    const reset = h('button', { class: 'btn small', id: `${this.prefix}-${def.id}-reset`, onClick: () => this.binding && this.store.dispatch(this.binding.set(def.id, null)) }, t('reset'));
    const element = h('details', { class: 'audio-effect', id: `${this.prefix}-${def.id}` },
      h('summary', {}, def.name),
      ...[...sliders.values()].map((s) => s.element),
      reset,
    );
    return { def, element, sliders };
  }

  bind(binding: EffectsBinding | null, effects: readonly EffectInstance[]): void {
    this.binding = binding;
    for (const { def, element, sliders } of this.rows) {
      const instance = effects.find((e) => e.type === def.id);
      element.classList.toggle('active', !!instance);
      for (const spec of def.params) sliders.get(spec.name)!.set(numberParam(instance?.params ?? {}, spec));
    }
  }

  sync(item: Item | null): void {
    this.bind(item ? itemEffects(item.id) : null, item?.effects ?? []);
  }
}
