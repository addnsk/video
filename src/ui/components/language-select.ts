import { saveLocalePreference } from '../../host/locale-preference';
import { LOCALES, currentLocale, isLocale, t } from '../../i18n';
import { h } from '../dom';

export function languageSelect(): HTMLSelectElement {
  const select = h('select', { id: 'language', class: 'language', 'aria-label': t('language') },
    ...Object.entries(LOCALES).map(([id, strings]) => h('option', { value: id, title: strings.languageName }, id.toUpperCase())));
  select.value = currentLocale();
  select.addEventListener('change', () => {
    if (!isLocale(select.value)) return;
    saveLocalePreference(select.value);
    location.reload();
  });
  return select;
}
