import { posts } from './balances';
import type { Ledger, Tx } from './types';

/**
 * What counts as spending — decided once.
 *
 * Three different definitions were in use. The daily limit counted posted
 * expenses excluding commitment settlements. The floor recommender counted
 * posted expenses including them. Insights counted every expense row,
 * including the non-posting ones that are history-only, despite a comment
 * saying otherwise.
 *
 * That is not a tidiness problem. `burnRate` projected the month from a total
 * that included the rent and compared it against `livingPool`, which has the
 * rent taken out — so it reported the user overrunning their living budget by
 * roughly the size of their rent, every month, on the 1st. And
 * `recommendFloor` read a percentile of daily totals with the rent in them,
 * so it proposed a living floor inflated by a bill that is not living, which
 * then took the difference straight out of the goal.
 */

/**
 * Does this entry move money at all?
 *
 * `post: false` marks a row that is already baked into the opening reconciled
 * balance and exists for display only. Counting it applies the same dirhams
 * twice.
 */
export function counts(x: Tx): boolean {
  return posts(x);
}

/**
 * Is this discretionary spending — the kind a daily limit governs?
 *
 * An expense that settles a commitment is real spending and belongs in
 * history, in the category breakdown and in the month's outgoings. It is not
 * discretionary: the salary already gave it up as a claim, so the daily
 * allowance must not charge it again, and no statistic about how the user
 * chooses to spend should be shaped by a bill they cannot choose about.
 */
export function isDiscretionary(x: Tx): boolean {
  return x.type === 'expense' && counts(x) && x.commitId == null;
}

/** Every expense that moves money, commitment settlements included. */
export function isOutgoing(x: Tx): boolean {
  return x.type === 'expense' && counts(x);
}

/** Discretionary spending in `[from, to]`, inclusive. */
export function discretionaryIn(
  ledger: Pick<Ledger, 'tx'>,
  from: number,
  to: number = Number.POSITIVE_INFINITY,
): Tx[] {
  return ledger.tx.filter((x) => isDiscretionary(x) && x.ts >= from && x.ts <= to);
}

/** Total discretionary spending in `[from, to]`, inclusive. */
export function discretionaryTotal(
  ledger: Pick<Ledger, 'tx'>,
  from: number,
  to: number = Number.POSITIVE_INFINITY,
): number {
  return discretionaryIn(ledger, from, to).reduce((a, x) => a + x.amt, 0);
}
