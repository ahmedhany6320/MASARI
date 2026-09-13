import { cycleKey } from './commitments';
import type { Ledger, OvertimeEntry, SalaryStatus } from './types';

/**
 * Things that must expire when the month turns.
 *
 * A flag with no cycle attached never clears itself. The commitments code
 * learned this the hard way — `paidMonth` was a bare boolean, so a bill ticked
 * once stayed ticked forever and silently left the daily limit. Two more
 * fields still had the same shape, and one figure was never scoped to a month
 * at all.
 *
 * Everything here is derived, never stored: the cycle is read from the date
 * the value was stamped with, so nothing has to run at midnight on the 1st for
 * the app to be correct on the 2nd.
 */

/** Salary standing for the cycle containing `now`. */
export interface SalaryCycle {
  /** The cycle being asked about, as 'YYYY-MM'. */
  cycle: string;
  /** Whether THIS month's salary has landed. */
  status: SalaryStatus;
  /** What actually landed this month, when it differed from the base. */
  actual: number | null;
  /** The figure to budget with: what landed, or the base if it has not yet. */
  amount: number;
  /**
   * True when the stored status belongs to an earlier month and was therefore
   * ignored. Worth surfacing: the user ticked "received" once and the app has
   * been showing it ever since.
   */
  stale: boolean;
}

/**
 * Whether the salary has landed for the cycle containing `now`.
 *
 * `salFor` stamps the cycle the status belongs to, exactly as `paidFor` does
 * for a commitment. Without it, marking September's salary received left the
 * app claiming October's, November's and every later salary had landed too —
 * so the "salary pending" prompt disappeared permanently after the first
 * month, and `salActual` from one good month went on inflating every month
 * after it.
 */
export function salaryCycle(
  s: Pick<Ledger, 'base' | 'salStatus' | 'salActual' | 'salFor'>,
  now: Date = new Date(),
): SalaryCycle {
  const cycle = cycleKey(now);
  const stamped = s.salFor ?? null;

  /*
   * An unstamped status is honoured for the current cycle only.
   *
   * Saves written before `salFor` existed carry a status with no cycle. Taking
   * it as current is the kinder reading — the user did tick it, and probably
   * this month — and it self-corrects the moment the month turns, because from
   * then on the absence is indistinguishable from a stale stamp.
   */
  const current = stamped == null ? true : stamped === cycle;
  const stale = !current && s.salStatus === 'received';

  const status: SalaryStatus = current ? s.salStatus : 'expected';
  const actual = current ? s.salActual : null;

  return {
    cycle,
    status,
    actual,
    amount: status === 'received' && actual != null && actual > 0 ? actual : s.base,
    stale,
  };
}

/** Overtime entries dated inside the cycle containing `now`. */
export function overtimeForCycle(entries: OvertimeEntry[], now: Date = new Date()): OvertimeEntry[] {
  const cycle = cycleKey(now);
  return entries.filter((e) => typeof e.date === 'string' && e.date.slice(0, 7) === cycle);
}

/**
 * Overtime earned in the cycle containing `now`.
 *
 * The salary screen was summing every entry ever recorded and presenting the
 * total as this month's overtime, so a good month in June went on being paid
 * out on screen in December.
 */
export function overtimeThisCycle(entries: OvertimeEntry[], now: Date = new Date()): number {
  return overtimeForCycle(entries, now).reduce((a, e) => a + e.h * e.rate * e.mult, 0);
}
