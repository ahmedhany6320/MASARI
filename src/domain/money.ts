import type { Lang } from './types';

/**
 * Money is displayed rounded to whole units with grouping separators.
 *
 * The grouping locale is pinned to `en-US` even in Arabic so the digits stay
 * Western (١٢٣ vs 123) and the separators stay familiar — matching the
 * prototype, which Arabic-speaking users had already been reading.
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

export const CURRENCY_LABEL: Record<Lang, { aed: string; egp: string }> = {
  ar: { aed: 'د.إ', egp: 'ج.م' },
  en: { aed: 'AED', egp: 'EGP' },
};

/** Amount with the salary-currency label attached, in the reader's language. */
export function formatMoney(n: number, lang: Lang): string {
  return `${formatAmount(n)} ${CURRENCY_LABEL[lang].aed}`;
}

/** Amount with the Egyptian pound label attached. */
export function formatEgp(n: number, lang: Lang): string {
  return `${formatAmount(n)} ${CURRENCY_LABEL[lang].egp}`;
}

/**
 * Parses a user-typed amount. Accepts Arabic-Indic digits, since an Arabic
 * keyboard produces them and the prototype silently rejected them.
 */
export function parseAmount(input: string): number | null {
  if (!input) return null;
  const normalized = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\s٬]/g, '')
    .replace(/٫/, '.')
    .trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
