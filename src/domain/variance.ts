import { cycleKey, isPaidFor } from './commitments';
import type { Commitment, Ledger, PlannedTransfer, Tx } from './types';

/**
 * Planned versus actual, and where the difference goes.
 *
 * A budget names a figure; a month produces a different one. Rent is budgeted
 * at 1,800 and paid at 1,750; a transfer is planned at 850 and 400 is sent.
 * Until now the app only knew the plan, so those differences vanished — the
 * salary was reduced by a claim that never fully materialised, and the money
 * sat in the account belonging to nothing.
 *
 * Every such difference belongs to the GOAL, in both directions. Underpay and
 * the goal gains; overpay and it gives ground. That is what makes the plan
 * answer to reality instead of the other way round, and it is the reason the
 * planned figure can stay a stable number to budget against: it no longer has
 * to be edited every time a bill lands a few dirhams off.
 */

export interface ObligationLine {
  id: string;
  /** Arabic label, for display. */
  label: string;
  /** The monthly plan. */
  planned: number;
  /** What was really paid, once settled. */
  actual: number | null;
  /** True when this cycle's obligation has been met. */
  settled: boolean;
  /**
   * Planned minus actual. Positive means it cost less than budgeted and the
   * surplus is the goal's; negative means it cost more and the goal covers it.
   */
  variance: number;
}

export interface VarianceReport {
  commitments: ObligationLine[];
  transfers: ObligationLine[];
  /** Total still expected to leave the account this cycle. */
  outstanding: number;
  /** Total already paid against this cycle's obligations. */
  paid: number;
  /** Everything budgeted this cycle, settled or not. */
  planned: number;
  /**
   * Net surplus from obligations that came in under plan, less any that came
   * in over. Added to the goal's monthly share.
   */
  toGoal: number;
  /** How many obligations are still waiting. */
  pending: number;
}

/** What a commitment actually cost this cycle, or null while unsettled. */
export function commitmentActual(c: Commitment, now: Date): number | null {
  if (!isPaidFor(c, now)) return null;
  // A settled commitment with no recorded figure cost exactly what was planned:
  // that is what marking it paid without editing the amount means.
  return c.actual != null ? c.actual : (c.amt ?? 0);
}

/** What has been remitted against a planned transfer this cycle. */
export function transferActual(
  tf: PlannedTransfer,
  tx: Tx[],
  now: Date,
): number | null {
  if (tf.sentFor !== cycleKey(now)) return null;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  // Sum what genuinely left for this purpose in this cycle, rather than
  // trusting the plan: the whole point is to notice when they differ.
  const sent = tx
    .filter((x) => x.type === 'remit' && x.ts >= monthStart)
    .reduce((a, x) => a + x.amt, 0);

  return sent;
}

export function varianceReport(
  ledger: Pick<Ledger, 'commits' | 'planTf' | 'tx'>,
  now: Date = new Date(),
): VarianceReport {
  const commitments: ObligationLine[] = ledger.commits
    .filter((c) => !c.paused)
    .map((c) => {
      const planned = c.amt ?? 0;
      const actual = commitmentActual(c, now);
      return {
        id: c.id,
        label: c.ar || c.en,
        planned,
        actual,
        settled: actual != null,
        variance: actual != null ? planned - actual : 0,
      };
    });

  /*
   * Every planned transfer is measured against the SAME pool of remittances,
   * so attributing that pool to each of them in turn would count it once per
   * plan. The sent total is therefore applied to the first settled plan and
   * the rest are treated as fully met — crude with several plans, exactly
   * right with the one that actually exists.
   */
  let remitClaimed = false;
  const transfers: ObligationLine[] = ledger.planTf.map((tf) => {
    const settled = tf.sentFor === cycleKey(now);
    if (!settled) {
      return { id: tf.id, label: '', planned: tf.amt, actual: null, settled: false, variance: 0 };
    }

    /*
     * The whole cycle's remittances answer to the FIRST settled plan, and any
     * further plans are recorded as met exactly. Splitting one pool of
     * transfers across several plans would either count it repeatedly or
     * require guessing which transfer belonged to which — and there is no
     * information in the ledger to guess from. With the single plan that
     * actually exists this is exact; with several it is at least not wrong in
     * the direction that invents money.
     */
    const actual = remitClaimed ? tf.amt : (transferActual(tf, ledger.tx, now) ?? 0);
    remitClaimed = true;

    return { id: tf.id, label: '', planned: tf.amt, actual, settled: true, variance: tf.amt - actual };
  });

  const all = [...commitments, ...transfers];
  const settled = all.filter((x) => x.settled);
  const pendingLines = all.filter((x) => !x.settled);

  return {
    commitments,
    transfers,
    outstanding: pendingLines.reduce((a, x) => a + x.planned, 0),
    paid: settled.reduce((a, x) => a + (x.actual ?? 0), 0),
    planned: all.reduce((a, x) => a + x.planned, 0),
    toGoal: settled.reduce((a, x) => a + x.variance, 0),
    pending: pendingLines.length,
  };
}
