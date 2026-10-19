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
  vertical?: boolean;
  fillFromMin?: boolean;
  onInput: (value: number) => void;
}

const DRAG_THRESHOLD = 3;

export class Slider {
  readonly element: HTMLDivElement;
  private fill: HTMLDivElement;
  private output: HTMLSpanElement;
  private editor: HTMLInputElement;
  private format: (value: number) => string;
  private current = 0;

  constructor(private options: SliderOptions) {
    const split = /^(.*\S)\s*\(([^()]+)\)$/.exec(options.label);
    const unit = split && !/\d/.test(split[2]) ? split[2] : '';
    const base = options.format ?? ((v) => v.toFixed(2));
    this.format = unit ? (v) => `${base(v)} ${unit}` : base;
    const shown = unit ? split![1] : options.label;
    this.fill = h('div', { class: 'scrub-fill' });
    this.output = h('span', { class: 'scrub-value' });
    this.editor = h('input', { class: 'scrub-editor', type: 'text', inputmode: 'decimal', hidden: true, 'aria-label': options.label });
    this.element = h('div', {
      class: options.vertical ? 'scrub vertical' : 'scrub',
      'aria-orientation': options.vertical ? 'vertical' : 'horizontal',
      id: options.id,
      role: 'slider',
      tabindex: 0,
      'aria-label': options.label,
      'aria-valuemin': options.min,
      'aria-valuemax': options.max,
    }, this.fill, h('span', { class: 'scrub-label' }, shown), this.output, this.editor);
    this.element.addEventListener('pointerdown', (e) => this.press(e));
    this.element.addEventListener('dblclick', () => this.commit(options.neutral));
    this.element.addEventListener('keydown', (e) => this.key(e));
    this.editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.editor.blur();
      if (e.key === 'Escape') this.closeEditor(false);
    });
    this.editor.addEventListener('blur', () => this.closeEditor(true));
    this.set(options.value);
  }

  get value(): number {
    return this.current;
  }

  set(value: number): void {
    const { min, max, neutral } = this.options;
    this.current = value;
    this.output.textContent = this.format(value);
    this.element.setAttribute('aria-valuenow', String(value));
    this.element.setAttribute('aria-valuetext', this.format(value));
    const span = max - min || 1;
    const at = (Math.min(max, Math.max(min, value)) - min) / span;
    const base = !this.options.fillFromMin && neutral > min && neutral < max ? (neutral - min) / span : 0;
    const [start, size] = this.options.vertical ? ['bottom', 'height'] as const : ['left', 'width'] as const;
    this.fill.style[start] = `${Math.min(at, base) * 100}%`;
    this.fill.style[size] = `${Math.abs(at - base) * 100}%`;
  }

  set disabled(value: boolean) {
    this.element.classList.toggle('disabled', value);
    this.element.setAttribute('aria-disabled', String(value));
    this.element.tabIndex = value ? -1 : 0;
  }

  private get isDisabled(): boolean {
    return this.element.classList.contains('disabled');
  }

  private clamp(value: number): number {
    const { min, max, step } = this.options;
    const snapped = Math.round((value - min) / step) * step + min;
    return Math.min(max, Math.max(min, +snapped.toFixed(6)));
  }

  private press(e: PointerEvent) {
    if (this.isDisabled || !this.editor.hidden || e.button !== 0) return;
    e.preventDefault();
    this.element.focus();
    const vertical = !!this.options.vertical;
    const startX = vertical ? -e.clientY : e.clientX;
    const start = this.current;
    const width = (vertical ? this.element.clientHeight : this.element.clientWidth) || 1;
    let dragging = false;
    this.element.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (vertical ? -ev.clientY : ev.clientX) - startX;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
      this.element.classList.add('dragging');
      const fine = ev.shiftKey ? 0.1 : 1;
      this.commit(this.clamp(start + (dx / width) * (this.options.max - this.options.min) * fine));
    };
    const up = () => {
      this.element.removeEventListener('pointermove', move);
      this.element.removeEventListener('pointerup', up);
      this.element.removeEventListener('pointercancel', up);
      this.element.classList.remove('dragging');
      if (!dragging) this.openEditor();
    };
    this.element.addEventListener('pointermove', move);
    this.element.addEventListener('pointerup', up);
    this.element.addEventListener('pointercancel', up);
  }

  private key(e: KeyboardEvent) {
    if (this.isDisabled || e.target !== this.element) return;
    const { step, min, max, neutral } = this.options;
    const big = (max - min) / 10;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      this.commit(this.clamp(this.current + delta * (e.shiftKey ? 10 : 1)));
    } else if (e.key === 'Home') this.commit(min);
    else if (e.key === 'End') this.commit(max);
    else if (e.key === 'Enter') this.openEditor();
    else if (e.key === 'Backspace' || e.key === 'Delete') this.commit(neutral);
    else return;
    e.preventDefault();
  }

  private openEditor() {
    this.editor.value = String(+this.current.toFixed(4));
    this.editor.hidden = false;
    this.element.classList.add('editing');
    this.editor.focus();
    this.editor.select();
  }

  private closeEditor(apply: boolean) {
    if (this.editor.hidden) return;
    this.editor.hidden = true;
    this.element.classList.remove('editing');
    const typed = parseFloat(this.editor.value.replace(',', '.'));
    if (apply && Number.isFinite(typed)) this.commit(this.clamp(typed));
    this.element.focus();
  }

  private commit(value: number) {
    if (value === this.current) return;
    this.set(value);
    this.options.onInput(value);
  }
}
