import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { LOCALES, chooseLocale, setLocale, setStrings, t } from '../../src/i18n';

describe('i18n', () => {
  it('has no empty strings', () => {
    for (const [key, value] of Object.entries(en)) expect(value, key).not.toBe('');
  });

  it('interpolates variables and keeps unknown placeholders', () => {
    const key = Object.keys(en)[0] as keyof typeof en;
    setStrings({ ...en, [key]: '{a} of {b}' });
    expect(t(key, { a: 1 })).toBe('1 of {b}');
    setStrings(en);
  });
});

describe('locales', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('have the same keys and placeholders as English', () => {
    for (const [id, strings] of Object.entries(LOCALES)) {
      expect(Object.keys(strings).sort(), id).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(strings[key]), `${id}.${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('chooses a saved locale, then the browser language, then English', () => {
    expect(chooseLocale('ru', ['en-US'])).toBe('ru');
    expect(chooseLocale(null, ['de-DE', 'ru-RU'])).toBe('ru');
    expect(chooseLocale('xx', ['fr'])).toBe('en');
  });

  it('switches strings', () => {
    setLocale('ru');
    expect(t('import')).not.toBe(en.import);
    setLocale('en');
    expect(t('import')).toBe(en.import);
  });
});
