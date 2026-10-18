import type { Item } from '../../core/model';
import { replaceEffect, upsertEffect } from '../../core/operations';
import { AUDIO_EFFECTS } from '../../effects/audio/builtin';
import { numberParam, type AudioEffectDef } from '../../effects/audio/types';
import type { Store } from '../../core/store';
import { t } from '../../i18n';
import { Slider } from '../components/slider';
import { h } from '../dom';

interface Row {
  def: AudioEffectDef;
  element: HTMLDetailsElement;
  sliders: Map<string, Slider>;
}

export class AudioEffectsSection {
  readonly element: HTMLDivElement;
  private rows: Row[];
  private itemId: string | null = null;

  constructor(private store: Store) {
    this.rows = AUDIO_EFFECTS.map((def) => this.row(def));
    this.element = h('div', { class: 'group audio-effects' }, h('h3', {}, t('audioEffects')), ...this.rows.map((r) => r.element));
  }

  private row(def: AudioEffectDef): Row {
    const sliders = new Map<string, Slider>();
    for (const spec of def.params) {
      sliders.set(spec.name, new Slider({
        id: `audio-${def.id}-${spec.name}`,
        label: spec.label ?? spec.name,
        min: spec.min ?? 0,
        max: spec.max ?? 1,
        step: spec.step ?? 0.01,
        value: Number(spec.default),
        neutral: Number(spec.default),
        format: (v) => `${+v.toFixed(1)}`,
        onInput: (value) => {
          if (this.itemId) this.store.dispatch(upsertEffect(this.itemId, def.id, { [spec.name]: value }), { coalesce: `audio:${this.itemId}:${def.id}:${spec.name}` });
        },
      }));
    }
    const reset = h('button', { class: 'btn small', id: `audio-${def.id}-reset`, onClick: () => this.itemId && this.store.dispatch(replaceEffect(this.itemId, def.id, null)) }, t('reset'));
    const element = h('details', { class: 'audio-effect', id: `audio-${def.id}` },
      h('summary', {}, def.name),
      ...[...sliders.values()].map((s) => s.element),
      reset,
    );
    return { def, element, sliders };
  }

  sync(item: Item | null): void {
    this.itemId = item?.id ?? null;
    for (const { def, element, sliders } of this.rows) {
      const instance = item?.effects.find((e) => e.type === def.id);
      element.classList.toggle('active', !!instance);
      for (const spec of def.params) sliders.get(spec.name)!.set(numberParam(instance?.params ?? {}, spec));
    }
  }
}
