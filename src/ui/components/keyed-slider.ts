import { t } from '../../i18n';
import { h } from '../dom';
import { Slider, type SliderOptions } from './slider';

export type KeyState = 'none' | 'animated' | 'onKey';

export interface KeyedSliderOptions extends SliderOptions {
  onToggleKey: () => void;
}

const GLYPH: Record<KeyState, string> = { none: '◇', animated: '◈', onKey: '◆' };

export class KeyedSlider {
  readonly element: HTMLDivElement;
  private slider: Slider;
  private key: HTMLButtonElement;

  constructor(options: KeyedSliderOptions) {
    this.slider = new Slider(options);
    this.key = h('button', { class: 'key', type: 'button', 'aria-label': `${options.label} keyframe`, title: t('keyframeHint'), onClick: options.onToggleKey }, GLYPH.none);
    this.element = h('div', { class: 'keyed' }, this.slider.element, this.key);
  }

  set(value: number, state: KeyState): void {
    this.slider.set(value);
    this.key.textContent = GLYPH[state];
    this.key.dataset.state = state;
  }

  set disabled(value: boolean) {
    this.slider.disabled = value;
    this.key.disabled = value;
  }
}
