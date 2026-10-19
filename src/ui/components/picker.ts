import { h } from '../dom';
import { icon } from '../icons';

const ENHANCED = new WeakSet<HTMLSelectElement>();
const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
const INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex')!;
let openMenu: { close: () => void } | null = null;

function enhance(select: HTMLSelectElement) {
  if (ENHANCED.has(select) || select.multiple || select.closest('.picker')) return;
  ENHANCED.add(select);
  const label = h('span', { class: 'picker-label' });
  const button = h('button', {
    type: 'button',
    class: 'picker-button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': select.getAttribute('aria-label') ?? select.closest('label')?.firstChild?.textContent ?? '',
  }, label, icon('chevron', 14));
  const wrap = h('span', { class: `picker ${select.className}`.trim() });
  select.replaceWith(wrap);
  wrap.append(button, select);
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const sync = () => {
    const option = select.selectedOptions[0];
    label.textContent = option?.textContent ?? '';
    button.disabled = select.disabled;
    wrap.classList.toggle('empty', !option);
  };

  Object.defineProperty(select, 'value', {
    configurable: true,
    get: () => VALUE.get!.call(select),
    set: (v: string) => {
      VALUE.set!.call(select, v);
      sync();
    },
  });
  Object.defineProperty(select, 'selectedIndex', {
    configurable: true,
    get: () => INDEX.get!.call(select),
    set: (v: number) => {
      INDEX.set!.call(select, v);
      sync();
    },
  });
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
  select.addEventListener('change', sync);

  const choose = (option: HTMLOptionElement) => {
    if (option.disabled) return;
    const changed = !option.selected;
    option.selected = true;
    sync();
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const open = () => {
    openMenu?.close();
    const items: HTMLButtonElement[] = [];
    const list = h('div', { class: 'picker-menu', role: 'listbox' });
    const add = (option: HTMLOptionElement, parent: HTMLElement) => {
      const item = h('button', {
        type: 'button',
        class: 'picker-option',
        role: 'option',
        'aria-selected': String(option.selected),
        disabled: option.disabled,
        onClick: () => {
          choose(option);
          close();
          button.focus();
        },
      }, h('span', {}, option.textContent ?? ''), option.selected && icon('check', 14));
      items.push(item);
      parent.append(item);
    };
    for (const child of select.children) {
      if (child instanceof HTMLOptGroupElement) {
        list.append(h('div', { class: 'picker-group' }, child.label));
        for (const option of child.querySelectorAll('option')) add(option, list);
      } else if (child instanceof HTMLOptionElement) add(child, list);
    }
    document.body.append(list);
    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 220 && above > below;
    list.style.minWidth = `${width}px`;
    list.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    list.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
    if (up) list.style.bottom = `${innerHeight - rect.top + 6}px`;
    else list.style.top = `${rect.bottom + 6}px`;
    button.setAttribute('aria-expanded', 'true');
    const current = items.find((i) => i.getAttribute('aria-selected') === 'true') ?? items.find((i) => !i.disabled);
    current?.focus();
    current?.scrollIntoView({ block: 'nearest' });
    const outside = (e: PointerEvent) => {
      if (!list.contains(e.target as Node) && !button.contains(e.target as Node)) close();
    };
    const keys = (e: KeyboardEvent) => {
      const enabled = items.filter((i) => !i.disabled);
      const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        close();
        button.focus();
      } else if (e.key === 'ArrowDown') enabled[Math.min(enabled.length - 1, at + 1)]?.focus();
      else if (e.key === 'ArrowUp') enabled[Math.max(0, at - 1)]?.focus();
      else if (e.key === 'Tab') close();
      else return;
      e.preventDefault();
    };
    const close = () => {
      list.remove();
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keys, true);
      removeEventListener('resize', close);
      if (openMenu?.close === close) openMenu = null;
    };
    openMenu = { close };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
    addEventListener('resize', close);
  };

  button.addEventListener('click', () => (button.getAttribute('aria-expanded') === 'true' ? openMenu?.close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
  sync();
}

export function enhanceSelects(root: HTMLElement): void {
  const scan = (node: ParentNode) => {
    if (node instanceof HTMLSelectElement) enhance(node);
    for (const select of node.querySelectorAll?.('select') ?? []) enhance(select);
  };
  scan(root);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node);
  }).observe(root, { childList: true, subtree: true });
}
