import type { ParamValue } from '../../core/model';
import { setTransition } from '../../core/operations';
import { findPlacement } from '../../core/timeline';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { ParamControls } from '../components/param-controls';
import { Slider } from '../components/slider';
import { h } from '../dom';
import type { Selection } from '../selection';
import { Panel } from './panel';

export class TransitionPanel extends Panel {
  private hint = h('p', { class: 'hint' }, t('transitionHint'));
  private type: HTMLSelectElement;
  private params = h('div');
  private renderedFor = '';

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    super('transition', t('transitionTitle'));
    this.type = h('select', { id: 'transition-type', 'aria-label': t('transitionTitle'), onChange: () => this.choose(this.type.value) });
    this.body.append(this.hint, this.type, this.params);
    session.registry.on('change', () => this.fillTypes());
    session.store.on('change', () => this.sync());
    selection.on('change', () => this.sync());
    this.fillTypes();
  }

  private get placement() {
    const id = this.selection.id;
    const p = id ? findPlacement(this.session.store.project, id) : null;
    return p && p.track.magnetic && p.index > 0 ? p : null;
  }

  private fillTypes() {
    this.type.replaceChildren(
      h('option', { value: '' }, t('transitionNone')),
      ...this.session.registry.transitions().map((d) => h('option', { value: d.id }, d.name)),
    );
    this.renderedFor = '';
    this.sync();
  }

  private choose(type: string) {
    const p = this.placement;
    if (!p) return;
    const previous = p.item.transitionIn;
    this.session.store.dispatch(setTransition(p.item.id, type ? { type, duration: previous?.duration ?? 1, params: {} } : null));
    const placed = findPlacement(this.session.store.project, p.item.id);
    if (placed) this.session.transport.seek(placed.start + placed.fadeIn / 2);
  }

  private update(patch: { duration?: number; params?: Record<string, ParamValue> }) {
    const p = this.placement;
    const current = p?.item.transitionIn;
    if (!p || !current) return;
    this.session.store.dispatch(
      setTransition(p.item.id, { ...current, duration: patch.duration ?? current.duration, params: { ...current.params, ...patch.params } }),
      { coalesce: `transition:${p.item.id}` },
    );
  }

  private sync() {
    const p = this.placement;
    this.hint.hidden = !!p;
    this.type.disabled = !p;
    const transition = p?.item.transitionIn ?? null;
    this.type.value = transition?.type ?? '';
    const key = p && transition ? `${p.item.id}:${transition.type}` : '';
    if (key === this.renderedFor) return;
    this.renderedFor = key;
    this.params.replaceChildren();
    if (!p || !transition) return;
    const def = this.session.registry.transition(transition.type);
    const length = new Slider({
      id: 'transition-length',
      label: t('transitionLength'),
      min: 0.1,
      max: 3,
      step: 0.05,
      value: transition.duration,
      neutral: 1,
      format: (v) => `${v.toFixed(2)} s`,
      onInput: (duration) => this.update({ duration }),
    });
    const controls = new ParamControls('transition', def?.params ?? [], transition.params, (name, value) => this.update({ params: { [name]: value } }));
    this.params.append(length.element, controls.element);
  }
}
