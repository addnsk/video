import { ANIMATION_PRESETS } from '../../core/presets';
import type { NodeCategory } from '../../effects/types';
import type { EditorSession } from '../../host/session';
import { t } from '../../i18n';
import type { Strings } from '../../i18n/en';
import { toast } from '../components/toast';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { EXAMPLES } from '../script-examples';
import type { Selection } from '../selection';
import { Panel } from './panel';

export type LibraryKind = 'effect' | 'transition' | 'title' | 'animation' | 'template' | 'script';

export interface LibraryEntry {
  readonly kind: LibraryKind;
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly icon: IconName;
}

export interface LibraryActions {
  addEffect(type: string): void;
  addTemplate(name: string): void;
  setTransition(type: string): void;
  addTitle(): void;
  setAnimation(id: string): void;
  loadScript(index: number): void;
}

const CATEGORY_ICON: Record<NodeCategory, IconName> = {
  composite: 'layers', transform: 'fit', blur: 'blur', generator: 'sparkle', mask: 'mask', color: 'palette', stylize: 'wand',
};

const SECTIONS: readonly { kind: LibraryKind; label: keyof Strings; icon: IconName; needsClip: boolean }[] = [
  { kind: 'effect', label: 'libraryEffects', icon: 'wand', needsClip: true },
  { kind: 'transition', label: 'libraryTransitions', icon: 'transition', needsClip: true },
  { kind: 'title', label: 'libraryTitles', icon: 'text', needsClip: false },
  { kind: 'animation', label: 'libraryAnimations', icon: 'motion', needsClip: true },
  { kind: 'template', label: 'libraryTemplates', icon: 'bookmarkPlus', needsClip: true },
  { kind: 'script', label: 'libraryScripts', icon: 'code', needsClip: false },
];

export class LibraryPanel extends Panel {
  private search = h('input', { type: 'search', id: 'library-search', placeholder: t('librarySearch'), 'aria-label': t('librarySearch') });
  private chips = h('div', { class: 'library-chips', role: 'tablist' });
  private list = h('div', { class: 'library-list' });
  private kind: LibraryKind | 'all' = 'all';

  constructor(
    private session: EditorSession,
    private selection: Selection,
    private actions: LibraryActions,
  ) {
    super('library', t('libraryTitle'));
    this.search.addEventListener('input', () => this.render());
    this.body.append(h('div', { class: 'library-search' }, icon('search', 16), this.search), this.chips, this.list);
    session.registry.on('change', () => this.schedule());
    selection.on('change', () => this.schedule());
    this.render();
  }

  entries(): LibraryEntry[] {
    const { registry, templates } = this.session;
    return [
      ...registry.nodes().map((d) => ({ kind: 'effect' as const, id: d.id, name: d.name, group: d.category, icon: CATEGORY_ICON[d.category] ?? 'wand' })),
      ...registry.transitions().map((d) => ({ kind: 'transition' as const, id: d.id, name: d.name, group: '', icon: 'transition' as const })),
      { kind: 'title', id: 'title', name: t('libraryBasicTitle'), group: '', icon: 'text' },
      ...ANIMATION_PRESETS.map((p) => ({ kind: 'animation' as const, id: p.id, name: p.name, group: p.phase, icon: 'motion' as const })),
      ...templates.list().map((tpl) => ({ kind: 'template' as const, id: tpl.name, name: tpl.name, group: '', icon: 'bookmarkPlus' as const })),
      ...EXAMPLES.map((ex, i) => ({ kind: 'script' as const, id: String(i), name: ex.name, group: '', icon: 'code' as const })),
    ];
  }

  protected render(): void {
    const query = this.search.value.trim().toLowerCase();
    const all = this.entries();
    this.chips.replaceChildren(
      this.chip('all', t('libraryAll'), 'grid'),
      ...SECTIONS.filter((s) => all.some((e) => e.kind === s.kind)).map((s) => this.chip(s.kind, t(s.label), s.icon)),
    );
    const shown = all.filter((e) => (this.kind === 'all' || e.kind === this.kind) && (!query || e.name.toLowerCase().includes(query)));
    const hasClip = !!this.selection.id;
    this.list.replaceChildren(...SECTIONS.flatMap((section) => {
      const items = shown.filter((e) => e.kind === section.kind);
      if (!items.length) return [];
      return [
        h('h3', { class: 'library-heading' }, t(section.label), h('span', {}, String(items.length))),
        h('div', { class: 'library-grid' }, ...items.map((entry) => h('button', {
          type: 'button',
          class: `library-tile${section.needsClip && !hasClip ? ' idle' : ''}`,
          dataset: { library: `${entry.kind}:${entry.id}` },
          title: section.needsClip && !hasClip ? t('librarySelectClip') : entry.name,
          onClick: () => this.apply(entry, section.needsClip),
        }, h('span', { class: `library-icon kind-${entry.kind}` }, icon(entry.icon, 22)), h('span', { class: 'library-name' }, entry.name)))),
      ];
    }));
    if (!this.list.childElementCount) this.list.append(h('p', { class: 'hint' }, t('libraryEmpty')));
  }

  private chip(kind: LibraryKind | 'all', label: string, name: IconName): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: 'library-chip',
      role: 'tab',
      'aria-selected': String(this.kind === kind),
      title: label,
      onClick: () => {
        this.kind = kind;
        this.render();
      },
    }, icon(name, 15), h('span', {}, label));
  }

  private apply(entry: LibraryEntry, needsClip: boolean) {
    if (needsClip && !this.selection.id) {
      toast(t('librarySelectClip'));
      return;
    }
    try {
      if (entry.kind === 'effect') this.actions.addEffect(entry.id);
      else if (entry.kind === 'transition') this.actions.setTransition(entry.id);
      else if (entry.kind === 'title') this.actions.addTitle();
      else if (entry.kind === 'animation') this.actions.setAnimation(entry.id);
      else if (entry.kind === 'template') this.actions.addTemplate(entry.id);
      else this.actions.loadScript(+entry.id);
      if (entry.kind !== 'script') toast(t('libraryApplied', { name: entry.name }));
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }
}
