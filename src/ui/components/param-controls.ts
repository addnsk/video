import type { ParamValue, ParamValues } from '../../core/model';
import type { ParamSpec } from '../../effects/types';
import { h } from '../dom';
import { Slider } from './slider';

export class ParamControls {
  readonly element: HTMLDivElement;

  constructor(
    idPrefix: string,
    specs: readonly ParamSpec[],
    values: ParamValues,
    onChange: (name: string, value: ParamValue) => void,
  ) {
    this.element = h('div', { class: 'group' });
    for (const spec of specs) {
      const control = this.control(`${idPrefix}-${spec.name}`, spec, values[spec.name] ?? (spec.default as ParamValue), (v) => onChange(spec.name, v));
      if (control) this.element.append(control);
    }
  }

  private control(id: string, spec: ParamSpec, value: ParamValue, onChange: (v: ParamValue) => void): HTMLElement | null {
    const label = spec.label ?? spec.name;
    if (spec.type === 'float' || spec.type === 'int') {
      return new Slider({
        id,
        label,
        min: spec.min ?? 0,
        max: spec.max ?? 1,
        step: spec.step ?? (spec.type === 'int' ? 1 : 0.01),
        value: Number(value),
        neutral: Number(spec.default),
        onInput: onChange,
      }).element;
    }
    if (spec.type === 'bool') {
      const input = h('input', { type: 'checkbox', id, checked: !!value, onChange: () => onChange(input.checked) });
      return h('label', { class: 'check' }, input, h('span', {}, label));
    }
    if (spec.type === 'enum') {
      const select = h('select', { id, onChange: () => onChange(select.value) }, ...spec.options.map((o) => h('option', { value: o.value }, o.label)));
      select.value = String(value);
      return h('label', { class: 'field' }, label, select);
    }
    if (spec.type === 'vec2' || spec.type === 'vec3' || spec.type === 'vec4') {
      const arr = (Array.isArray(value) ? value : [value]) as number[];
      const group = h('div', { class: 'vector' }, h('span', {}, label));
      arr.forEach((component, i) => {
        const input = h('input', {
          type: 'number',
          id: `${id}-${i}`,
          step: spec.step ?? 0.1,
          value: component,
          onChange: () => {
            const next = arr.slice();
            next[i] = +input.value;
            onChange(next);
          },
        });
        group.append(input);
      });
      return group;
    }
    return null;
  }
}
