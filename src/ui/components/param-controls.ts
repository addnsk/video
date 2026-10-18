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
    if (spec.type === 'text') {
      const area = h('textarea', { id, rows: 3, class: 'plain', 'aria-label': label });
      area.value = String(value);
      area.addEventListener('input', () => onChange(area.value));
      return h('label', { class: 'field' }, label, area);
    }
    if (spec.type === 'enum') {
      const select = h('select', { id, onChange: () => onChange(select.value) }, ...spec.options.map((o) => h('option', { value: o.value }, o.label)));
      select.value = String(value);
      return h('label', { class: 'field' }, label, select);
    }
    if (spec.type === 'color') {
      const rgba = (Array.isArray(value) ? value : spec.default) as number[];
      const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
      const picker = h('input', { type: 'color', id, value: `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}` });
      const alpha = new Slider({
        id: `${id}-alpha`,
        label: 'Alpha',
        min: 0,
        max: 1,
        step: 0.01,
        value: rgba[3] ?? 1,
        neutral: 1,
        onInput: (a) => commit(a),
      });
      const commit = (a = Number(rgba[3] ?? 1)) => {
        const v = picker.value;
        const next = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
        rgba.splice(0, 4, ...next, a);
        onChange([...rgba]);
      };
      picker.addEventListener('input', () => commit());
      return h('div', { class: 'color-param' }, h('label', { class: 'check' }, picker, h('span', {}, label)), alpha.element);
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
