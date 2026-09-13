import { useMemo } from 'react';
import {
  burnRate,
  cardPosition,
  formatAmount,
  formatMoney,
  safeSpend,
  savingSummary,
  type CardPosition,
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
export function useCapacity(): Capacity {
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);

  return useMemo(() => {
    const now = new Date();
    const c = safeSpend(ledger, fxRate, now);
    const burn = burnRate(ledger, c.livingPool, now);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // The pool BEFORE any goal reservation: reserving for the goal and then
    // asking what is left for the goal would be circular.
    const poolBeforeGoal = ledger.base - c.commitObl - c.planT - c.cardDue;

    return {
      poolBeforeGoal,
      projectedSpend: burn.projectedMonth,
      saving: poolBeforeGoal - burn.projectedMonth,
      daysInMonth,
    };
  }, [ledger, fxRate]);
}
