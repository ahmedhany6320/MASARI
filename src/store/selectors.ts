import { useMemo } from 'react';
import {
  cardPosition,
  formatAmount,
  formatMoney,
  safeSpend,
  savingSummary,
  type CardPosition,
  type SafeSpend,
  type SavingSummary,
} from '../domain';
import { STRINGS, isRtl, type StringKey } from '../i18n';
import { paletteFor, type Palette } from '../theme/tokens';
import { useLedger } from './useLedger';

/**
 * Derived money figures.
 *
 * Recomputed from the ledger rather than stored, so they can never disagree
 * with the transactions behind them. The clock is read once per recompute and
 * handed to the pure engine.
 */
export function useSafeSpend(): SafeSpend {
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  return useMemo(() => safeSpend(ledger, fxRate, new Date()), [ledger, fxRate]);
}

export function useCardPosition(): CardPosition {
  const ledger = useLedger((s) => s.ledger);
  return useMemo(() => cardPosition(ledger), [ledger]);
}

export function useSavingSummary(): SavingSummary {
  const ledger = useLedger((s) => s.ledger);
  return useMemo(() => savingSummary(ledger, new Date()), [ledger]);
}

export interface Localization {
  lang: 'ar' | 'en';
  rtl: boolean;
  t: (key: StringKey) => string;
  /** Amount with the salary-currency label. */
  money: (n: number) => string;
  /** Bare grouped amount, no label. */
  num: (n: number) => string;
}

export function useLocalization(): Localization {
  const lang = useLedger((s) => s.settings.lang);
  return useMemo(() => {
    const table = STRINGS[lang];
    return {
      lang,
      rtl: isRtl(lang),
      t: (key: StringKey) => table[key],
      money: (n: number) => formatMoney(n, lang),
      num: formatAmount,
    };
  }, [lang]);
}

export function usePalette(): Palette {
  const theme = useLedger((s) => s.settings.theme);
  return useMemo(() => paletteFor(theme), [theme]);
}
