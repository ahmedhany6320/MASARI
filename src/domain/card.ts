import { posts } from './balances';
import type { CardSetup, Ledger } from './types';

export interface CardPosition {
  /** Statement balance at setup. */
  stmt0: number;
  /** Statement balance still unpaid. */
  stmtRem: number;
  /** Spending not yet billed. */
  unbilled: number;
  /** Installment plan balance. */
  instBal: number;
  /** Installment charge per month. */
  instMo: number;
  /** Everything drawn against the limit. */
  utilized: number;
  /** Headroom left on the card. */
  avail: number;
  paidThisStmt: number;
  /** Card spending recorded since setup. */
  purch: number;
  txCount: number;
  /** What you owe the card right now, excluding the installment balance. */
  out: number;
}

const EMPTY: Required<CardSetup> = { stmt0: 0, unbilled0: 0, instBal: 0, instMo: 0 };

/**
 * Reconstructs the credit-card position from the opening setup plus the
 * ledger.
 *
 * Payments are applied to the statement first and only the *leftover* reduces
 * unbilled spending — that is how a real card works, and getting it backwards
 * would understate what is owed. Both figures are floored at zero so an
 * overpayment cannot produce a negative liability.
 */
export function cardPosition(
  s: Pick<Ledger, 'cardSetup' | 'cardAdj' | 'cardCfg' | 'tx'>,
): CardPosition {
  const st = { ...EMPTY, ...(s.cardSetup ?? {}) };
  const { stmt0, unbilled0, instBal, instMo } = st;

  let purch = 0;
  let paid = 0;
  let txCount = 0;
  for (const x of s.tx) {
    if (!posts(x)) continue;
    if (x.type === 'expense' && x.acct === 'card') {
      purch += x.amt;
      txCount++;
    } else if (x.type === 'ccpay') {
      paid += x.amt;
    }
  }

  const stmtRem = Math.max(0, stmt0 - paid);
  const leftover = Math.max(0, paid - stmt0);
  const unbilled = Math.max(0, unbilled0 + purch + s.cardAdj - leftover);
  const utilized = stmtRem + unbilled + instBal;

  return {
    stmt0,
    stmtRem,
    unbilled,
    instBal,
    instMo,
    utilized,
    avail: s.cardCfg.limit - utilized,
    paidThisStmt: Math.min(paid, stmt0),
    purch,
    txCount,
    out: stmtRem + unbilled,
  };
}
