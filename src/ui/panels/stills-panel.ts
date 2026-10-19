import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import { Slider } from '../components/slider';
import { toast } from '../components/toast';
import { h } from '../dom';
import { iconButton } from '../icons';
import type { Selection } from '../selection';
import { Panel } from './panel';

export class StillsPanel extends Panel {
  private grid = h('div', { class: 'stills-grid', id: 'stills-grid' });
  private wipe: Slider;
  private rendered = '';

  constructor(
    private session: EditorSession,
    private selection: Selection,
  ) {
    super('stills', t('stillsTitle'));
    const grab = iconButton('camera', t('stillGrab'), { id: 'still-grab', onClick: () => this.grab() });
    this.wipe = new Slider({
      id: 'still-wipe',
      label: t('stillWipe'),
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      neutral: 0.5,
      onInput: (v) => void session.stills.wipe(v),
    });
    this.body.append(h('p', { class: 'hint' }, t('stillsHint')), grab, this.grid, this.wipe.element);
    session.store.on('change', () => this.render());
    this.render();
  }

  private async grab() {
    try {
      await this.session.stills.grab({ itemId: this.selection.id ?? undefined });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  protected render(force = false) {
    const stills = this.session.stills.list;
    const key = `${stills.map((s) => s.id).join()}|${this.session.stills.compared}`;
    if (key === this.rendered && !force) return;
    this.rendered = key;
    this.wipe.element.hidden = !this.session.stills.compared;
    this.grid.replaceChildren(
      ...stills.map((still) => {
        const active = this.session.stills.compared === still.id;
        const compare = async () => {
          await this.session.stills.compare(active ? null : still.id);
          this.render(true);
        };
        const apply = () => {
          const id = this.selection.id;
          if (!id) return toast(t('stillSelectClip'), 'error');
          this.session.stills.applyTo(still.id, [id]);
          toast(t('stillApplied', { name: still.name }));
        };
        return h('figure', { class: `still${active ? ' active' : ''}`, dataset: { still: still.id } },
          h('img', { src: still.image, alt: still.name, title: t('stillCompare'), onClick: compare }),
          h('figcaption', {}, still.name),
          h('div', { class: 'row' },
            iconButton('copy', t('stillApply'), { dataset: { action: 'apply' }, onClick: apply }),
            iconButton('trash', t('delete'), { dataset: { action: 'remove' }, onClick: () => this.session.stills.remove(still.id) }),
          ),
        );
      }),
    );
  }
}
