import { en, type Strings } from './en';

let strings: Strings = en;

export const setStrings = (next: Strings): void => {
  strings = next;
};

export function t(key: keyof Strings, vars: Record<string, string | number> = {}): string {
  return strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
