import { en, type Strings } from './en';
import { ru } from './ru';

export const LOCALES = { en, ru } as const satisfies Record<string, Strings>;
export type Locale = keyof typeof LOCALES;

let strings: Strings = en;
let current: Locale = 'en';

export const setStrings = (next: Strings): void => {
  strings = next;
};

export function setLocale(locale: Locale): void {
  current = locale;
  strings = LOCALES[locale];
}

export const currentLocale = (): Locale => current;

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && value in LOCALES;

export function chooseLocale(saved: string | null, preferred: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function t(key: keyof Strings, vars: Record<string, string | number> = {}): string {
  return strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
