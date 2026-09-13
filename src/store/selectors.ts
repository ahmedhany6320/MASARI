import { useMemo } from 'react';
import {
  burnRate,
  cardPosition,
  evaluateFinancialState,
  formatAmount,
  formatMoney,
  safeSpend,
  savingSummary,
  type CardPosition,
  type FinancialState,
  type SafeSpend,
  type SavingSummary,
} from '../domain';
import type { Capacity } from '../domain';
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

/**
 * The whole financial picture, from the one entry point.
 *
 * Screens should read this rather than calling domain functions individually:
 * the figures here are guaranteed to describe the same goal, the same month
 * and the same instant, which separate calls were not. `state.detail` holds
 * everything `useSafeSpend` returned, so a screen can move across a field at
 * a time.
 */
export function useFinancialState(): FinancialState {
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  return useMemo(
    () => evaluateFinancialState(ledger, new Date(), { fx: fxRate }),
    [ledger, fxRate],
  );
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


/**
 * Monthly saving capacity — the figure every goal projection is built on.
 *
 * Uses PROJECTED month spending rather than month-to-date. Before payday the
 * to-date figure reads as near-zero and would make every projection
 * absurdly optimistic; projecting the whole month at the observed pace is the
 * honest basis for a plan.
 */
/**
 * Goal-planning capacity, read from the one evaluation that produced it.
 *
 * This used to build its own: a second `safeSpend` call at a second clock
 * reading, with the month's living estimated from the BURN RATE — a
 * straight-line extrapolation of whatever had been recorded so far. With two
 * purchases logged that read as 193 a month against a planned 1,200, so the
 * goal screen announced 6,327 a month of saving where the engine reserved 923.
 */
export function useCapacity(): Capacity {
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  return useMemo(() => safeSpend(ledger, fxRate, new Date()).capacity, [ledger, fxRate]);
}
