import { chooseLocale, setLocale, type Locale } from '../i18n';

const KEY = 'montage.locale';

const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function applyLocalePreference(): Locale {
  const locale = chooseLocale(read(), navigator.languages ?? [navigator.language]);
  setLocale(locale);
  document.documentElement.lang = locale;
  return locale;
}

export function saveLocalePreference(locale: Locale): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {}
}
