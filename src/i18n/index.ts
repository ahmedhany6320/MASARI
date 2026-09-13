import { ar, type StringKey } from './ar';
import { en } from './en';
import type { Lang } from '../domain/types';

export type { StringKey };
export { ar, en };

export const STRINGS: Record<Lang, Record<StringKey, string>> = { ar, en };

export const MONTHS: Record<Lang, string[]> = {
  ar: [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** Arabic is written right-to-left; every layout decision keys off this. */
export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

/** Returns a lookup bound to one language. */
export function translator(lang: Lang) {
  const table = STRINGS[lang];
  return (key: StringKey): string => table[key];
}

/** Short date, ordered the way each language reads it. */
export function formatShortDate(d: Date, lang: Lang): string {
  const month = MONTHS[lang][d.getMonth()] ?? '';
  return lang === 'ar' ? `${d.getDate()} ${month}` : `${month} ${d.getDate()}`;
}
