import { h } from '../dom';

export interface SliderOptions {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  neutral: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}

export class Slider {
  readonly element: HTMLLabelElement;
  private input: HTMLInputElement;
  private output: HTMLOutputElement;
  private format: (value: number) => string;

  constructor(private options: SliderOptions) {
    this.format = options.format ?? ((v) => v.toFixed(2));
    this.input = h('input', { type: 'range', id: options.id, min: options.min, max: options.max, step: options.step });
    this.output = h('output');
    this.element = h('label', { class: 'slider' }, h('span', {}, options.label), this.input, this.output);
    this.input.addEventListener('input', () => this.commit(+this.input.value));
    this.input.addEventListener('dblclick', () => this.commit(options.neutral));
    this.set(options.value);
  }

  set(value: number): void {
    this.input.value = String(value);
    this.output.textContent = this.format(value);
  }

  set disabled(value: boolean) {
    this.input.disabled = value;
  }

  private commit(value: number) {
    this.set(value);
    this.options.onInput(value);
  }
}
