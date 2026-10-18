import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { setStrings, t } from '../../src/i18n';

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
