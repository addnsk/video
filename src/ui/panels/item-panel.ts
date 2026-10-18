import { PROPERTY, keyAt, valueAt } from '../../core/animation';
import { MAX_SPEED, MIN_SPEED, type Item, type PresetPhase, type TextStyle } from '../../core/model';
import { ANIMATION_PRESETS } from '../../core/presets';
import { clearAnimation, deleteKeyframe, setItemProps, setKeyframe, setPreset, setSpeed, setTextStyle, type ItemProps } from '../../core/operations';
import { findPlacement, type Placement } from '../../core/timeline';
import { TEXT_FONTS } from '../../engine/fonts';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { KeyedSlider, type KeyState } from '../components/keyed-slider';
import { Slider } from '../components/slider';
import { h } from '../dom';
import type { Selection } from '../selection';
import { AudioEffectsSection } from './audio-effects-section';
import { Panel } from './panel';

interface PropertyDef {
  path: string;
  label: 'volume' | 'opacity' | 'positionX' | 'positionY' | 'scale' | 'rotation';
  min: number;
  max: number;
  step: number;
  neutral: number;
  read: (item: Item) => number;
  write: (value: number) => ItemProps;
  format: (value: number) => string;
  visible: (placement: Placement, session: EditorSession) => boolean;
}

const percent = (v: number) => `${Math.round(v * 100)}%`;
const isVisual = (p: Placement) => p.track.kind === 'video';
const hasAudio = (p: Placement, s: EditorSession) => p.item.kind === 'media' && !!s.store.project.assets[p.item.source.assetId]?.hasAudio;

const PROPERTIES: PropertyDef[] = [
  { path: PROPERTY.volume, label: 'volume', min: 0, max: 2, step: 0.01, neutral: 1, read: (i) => i.volume, write: (volume) => ({ volume }), format: percent, visible: hasAudio },
  { path: PROPERTY.opacity, label: 'opacity', min: 0, max: 1, step: 0.01, neutral: 1, read: (i) => i.opacity, write: (opacity) => ({ opacity }), format: percent, visible: isVisual },
  { path: PROPERTY.x, label: 'positionX', min: -1, max: 1, step: 0.005, neutral: 0, read: (i) => i.transform.x, write: (x) => ({ transform: { x } }), format: (v) => v.toFixed(2), visible: isVisual },
  { path: PROPERTY.y, label: 'positionY', min: -1, max: 1, step: 0.005, neutral: 0, read: (i) => i.transform.y, write: (y) => ({ transform: { y } }), format: (v) => v.toFixed(2), visible: isVisual },
  { path: PROPERTY.scale, label: 'scale', min: 0.05, max: 4, step: 0.01, neutral: 1, read: (i) => i.transform.scale, write: (scale) => ({ transform: { scale } }), format: percent, visible: isVisual },
  { path: PROPERTY.rotation, label: 'rotation', min: -180, max: 180, step: 0.5, neutral: 0, read: (i) => i.transform.rotation, write: (rotation) => ({ transform: { rotation } }), format: (v) => `${v.toFixed(1)}°`, visible: isVisual },
];

export class ItemPanel extends Panel {
  private hint = h('p', { class: 'hint' }, t('itemHint'));
  private rows = new Map<string, { def: PropertyDef; slider: KeyedSlider }>();
  private textBox: HTMLDivElement;
  private content: HTMLTextAreaElement;
  private font: HTMLSelectElement;
  private weight: HTMLSelectElement;
  private size: HTMLInputElement;
  private color: HTMLInputElement;
  private align: HTMLSelectElement;
  private background: HTMLInputElement;
  private backgroundColor: HTMLInputElement;
  private renderedText = '';
  private speed: Slider;
  private audioEffects: AudioEffectsSection;
  private presets = new Map<PresetPhase, HTMLSelectElement>();
  private presetBox: HTMLDivElement;

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    super('item', t('itemTitle'));
    const properties = h('div', { class: 'group' });
    for (const def of PROPERTIES) {
      const slider = new KeyedSlider({
        id: `item-${def.label}`,
        label: t(def.label),
        min: def.min,
        max: def.max,
        step: def.step,
        value: def.neutral,
        neutral: def.neutral,
        format: def.format,
        onInput: (v) => this.change(def, v),
        onToggleKey: () => this.toggleKey(def),
      });
      this.rows.set(def.path, { def, slider });
      properties.append(slider.element);
    }

    this.speed = new Slider({
      id: 'item-speed',
      label: t('speed'),
      min: Math.log2(MIN_SPEED),
      max: Math.log2(MAX_SPEED),
      step: 0.01,
      value: 0,
      neutral: 0,
      format: (v) => `${+(2 ** v).toFixed(2)}×`,
      onInput: (v) => {
        const p = this.placement;
        if (p) this.session.store.dispatch(setSpeed(p.item.id, 2 ** v), { coalesce: `speed:${p.item.id}` });
      },
    });

    const style = (patch: Partial<TextStyle>) => {
      const p = this.placement;
      if (p) this.session.store.dispatch(setTextStyle(p.item.id, patch), { coalesce: `text:${p.item.id}:${Object.keys(patch)[0]}` });
    };
    this.content = h('textarea', { id: 'text-content', rows: 3, 'aria-label': t('textContent'), class: 'plain' });
    this.content.addEventListener('input', () => style({ content: this.content.value }));
    this.font = h('select', { id: 'text-font' }, ...TEXT_FONTS.map((f) => h('option', { value: f }, f)));
    this.font.addEventListener('change', () => style({ font: this.font.value }));
    this.weight = h('select', { id: 'text-weight' }, h('option', { value: '400' }, t('weightRegular')), h('option', { value: '700' }, t('weightBold')));
    this.weight.addEventListener('change', () => style({ weight: +this.weight.value }));
    this.size = h('input', { type: 'range', id: 'text-size', min: 0.02, max: 0.3, step: 0.005 });
    this.size.addEventListener('input', () => style({ size: +this.size.value }));
    this.color = h('input', { type: 'color', id: 'text-color' });
    this.color.addEventListener('input', () => style({ color: this.color.value }));
    this.align = h('select', { id: 'text-align' }, ...(['left', 'center', 'right'] as const).map((a) => h('option', { value: a }, t(`align_${a}`))));
    this.align.addEventListener('change', () => style({ align: this.align.value as TextStyle['align'] }));
    this.background = h('input', { type: 'checkbox', id: 'text-bg' });
    this.backgroundColor = h('input', { type: 'color', id: 'text-bg-color', value: '#000000' });
    const updateBackground = () => style({ background: this.background.checked ? `${this.backgroundColor.value}b3` : null });
    this.background.addEventListener('change', updateBackground);
    this.backgroundColor.addEventListener('input', updateBackground);
    this.textBox = h('div', { class: 'group' },
      this.content,
      h('div', { class: 'row' }, this.font, this.weight),
      h('label', { class: 'slider' }, h('span', {}, t('textSize')), this.size, h('output')),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, this.color, h('span', {}, t('textColor'))),
        this.align),
      h('label', { class: 'check' }, this.background, this.backgroundColor, h('span', {}, t('textBackground'))),
    );

    this.audioEffects = new AudioEffectsSection(session.store);
    const phases: { phase: PresetPhase; label: 'animationIn' | 'animationOut' | 'animationWhole' }[] = [
      { phase: 'in', label: 'animationIn' },
      { phase: 'out', label: 'animationOut' },
      { phase: 'whole', label: 'animationWhole' },
    ];
    this.presetBox = h('div', { class: 'group presets' },
      ...phases.map(({ phase, label }) => {
        const select = h('select', { id: `preset-${phase}` },
          h('option', { value: '' }, t('animationNone')),
          ...ANIMATION_PRESETS.filter((p) => p.phase === phase).map((p) => h('option', { value: p.id }, p.name)),
        );
        select.addEventListener('change', () => {
          const p = this.placement;
          if (p) this.session.store.dispatch(setPreset(p.item.id, phase, select.value || null));
        });
        this.presets.set(phase, select);
        return h('label', { class: 'field' }, t(label), select);
      }),
    );
    this.body.append(this.hint, this.textBox, this.speed.element, this.presetBox, properties, h('p', { class: 'hint' }, t('keyframeHint')), this.audioEffects.element);
    session.store.on('change', () => this.sync());
    selection.on('change', () => this.sync());
    let pending = false;
    session.transport.on('time', () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this.sync();
      });
    });
    this.sync();
  }

  private get placement(): Placement | null {
    const id = this.selection.id;
    return id ? findPlacement(this.session.store.project, id) : null;
  }

  private local(p: Placement): number {
    return Math.min(Math.max(0, this.session.transport.time - p.start), p.end - p.start);
  }

  private change(def: PropertyDef, value: number) {
    const p = this.placement;
    if (!p) return;
    const animated = !!p.item.animations[def.path];
    const op = animated ? setKeyframe(p.item.id, def.path, this.local(p), value) : setItemProps(p.item.id, def.write(value));
    this.session.store.dispatch(op, { coalesce: `prop:${p.item.id}:${def.path}` });
  }

  private toggleKey(def: PropertyDef) {
    const p = this.placement;
    if (!p) return;
    const local = this.local(p);
    const keys = p.item.animations[def.path];
    if (keyAt(keys, local)) {
      this.session.store.dispatch(keys!.length === 1 ? clearAnimation(p.item.id, def.path) : deleteKeyframe(p.item.id, def.path, local));
      return;
    }
    this.session.store.dispatch(setKeyframe(p.item.id, def.path, local, valueAt(keys, local, def.read(p.item))));
  }

  private sync() {
    const p = this.placement;
    this.hint.hidden = !!p;
    this.element.classList.toggle('disabled', !p);
    this.textBox.hidden = p?.item.kind !== 'text';
    this.speed.element.hidden = p?.item.kind !== 'media';
    if (p?.item.kind === 'media') this.speed.set(Math.log2(p.item.speed));
    this.audioEffects.element.hidden = !p || !hasAudio(p, this.session);
    this.presetBox.hidden = !p || !isVisual(p);
    for (const [phase, select] of this.presets) select.value = p?.item.presets[phase] ?? '';
    this.audioEffects.sync(p?.item ?? null);
    for (const { def, slider } of this.rows.values()) {
      const visible = !!p && def.visible(p, this.session);
      slider.element.hidden = !visible;
      if (!p || !visible) continue;
      const local = this.local(p);
      const keys = p.item.animations[def.path];
      const state: KeyState = keyAt(keys, local) ? 'onKey' : keys ? 'animated' : 'none';
      slider.set(valueAt(keys, local, def.read(p.item)), state);
    }
    if (p?.item.kind === 'text') this.syncText(p.item.text, p.item.id);
  }

  private syncText(style: TextStyle, id: string) {
    const key = `${id}:${JSON.stringify(style)}`;
    if (key === this.renderedText) return;
    this.renderedText = key;
    if (document.activeElement !== this.content) this.content.value = style.content;
    this.font.value = style.font;
    this.weight.value = String(style.weight >= 600 ? 700 : 400);
    this.size.value = String(style.size);
    (this.size.nextElementSibling as HTMLOutputElement).textContent = `${Math.round(style.size * 100)}%`;
    this.color.value = style.color.slice(0, 7);
    this.align.value = style.align;
    this.background.checked = !!style.background;
    if (style.background) this.backgroundColor.value = style.background.slice(0, 7);
  }
}
