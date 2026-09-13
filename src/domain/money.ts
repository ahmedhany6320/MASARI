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

/**
 * Storage normalisation.
 *
 * Every amount that enters the ledger goes through here, so there is one
 * answer to "what is a valid stored amount" instead of one per screen.
 *
 * Two failures this prevents. Binary floating point turns 0.1 + 0.2 into
 * 0.30000000000000004, and a year of that drifts a balance by cents that no
 * receipt can explain. And a typed minus sign would put a negative into a
 * field whose sign is already carried by the transaction type, so an expense
 * of -50 would silently *raise* the balance.
 */

/** Smallest amount worth distinguishing: one fils. */
export const MONEY_EPSILON = 0.005;

/** Rounds to the minor unit, killing accumulated binary drift. */
export function normalizeAmount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Normalises an amount whose direction is carried elsewhere, so it must be a
 * magnitude. A negative becomes its absolute value rather than being rejected:
 * someone typing `-50` into "how much did you spend" means fifty, and refusing
 * the entry would lose the record entirely.
 */
export function normalizeMagnitude(n: number): number {
  return Math.abs(normalizeAmount(n));
}

/** Compares two amounts at the precision money is actually stored in. */
export function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) < MONEY_EPSILON;
}
