import type { Ledger, Tx } from './types';

/**
 * A ledger entry posts unless it is explicitly marked `post: false`, which
 * means it is already inside the opening reconciled balance and applying it
 * again would double-count.
 */
export function posts(x: Tx): boolean {
  return x.post !== false;
}

/**
 * Bank balance = opening reconciled balance + every posting entry's effect.
 *
 * Note the asymmetry with cash: `remit`, `wd`, `dep` and `adjust` always hit
 * the bank regardless of their `acct` field, because those movements are
 * defined against the bank by construction (you remit from a bank, and a
 * withdrawal is bank→cash).
 */
export function bankBalance(s: Pick<Ledger, 'bankOpen' | 'tx'>): number {
  let b = s.bankOpen;
  for (const x of s.tx) {
    if (!posts(x)) continue;
    switch (x.type) {
      case 'income':
        if (x.acct === 'bank') b += x.amt;
        break;
      case 'expense':
      case 'ccpay':
      case 'debtpay':
        if (x.acct === 'bank') b -= x.amt;
        break;
      case 'lend':
        if (x.acct === 'bank') b -= x.amt;
        break;
      case 'borrow':
        if (x.acct === 'bank') b += x.amt;
        break;
      case 'remit':
      case 'wd':
        b -= x.amt;
        break;
      case 'dep':
        b += x.amt;
        break;
      // Reconciliation corrections are signed: a negative `amt` lowers the
      // balance. This is the only entry type that is allowed to be negative.
      case 'adjust':
        b += x.amt;
        break;
    }
  }
  return b;
}

/**
 * Cash balance, or `null` when the user has never opted into tracking cash —
 * which is different from tracking it and holding zero, and the UI shows the
 * two differently.
 *
 * `wd` and `dep` are mirrored here: a withdrawal raises cash while lowering
 * the bank, and a deposit does the reverse.
 */
export function cashBalance(s: Pick<Ledger, 'cashOpen' | 'tx'>): number | null {
  if (s.cashOpen == null) return null;
  let c = s.cashOpen;
  for (const x of s.tx) {
    if (!posts(x)) continue;
    switch (x.type) {
      case 'income':
        if (x.acct === 'cash') c += x.amt;
        break;
      case 'expense':
      case 'ccpay':
      case 'debtpay':
        if (x.acct === 'cash') c -= x.amt;
        break;
      case 'lend':
        if (x.acct === 'cash') c -= x.amt;
        break;
      case 'wd':
        c += x.amt;
        break;
      case 'dep':
        c -= x.amt;
        break;
    }
  }
  return c;
}
