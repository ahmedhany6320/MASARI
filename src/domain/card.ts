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

const EMPTY: Required<CardSetup> = {
  stmt0: 0, unbilled0: 0, instBal: 0, instMo: 0, setupAt: null,
};

/**
 * Whole months elapsed between two instants, by calendar month rather than by
 * dividing days — an installment is charged on a date, not every 30.4 days.
 */
export function monthsElapsed(from: number, now: Date): number {
  const a = new Date(from);
  let months = (now.getFullYear() - a.getFullYear()) * 12 + (now.getMonth() - a.getMonth());
  // The month only counts once its day-of-month has come round again.
  if (now.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * The installment balance as it stands today.
 *
 * The opening figure is what was owed at setup; every month since has taken
 * one monthly charge off it. Leaving it static meant the app showed the same
 * plan balance in month one and month twelve, so paying it down never showed
 * up anywhere — and the "deferred" figure stayed permanently overstated.
 */
export function amortizedInstBal(st: Required<CardSetup>, now: Date): number {
  if (st.setupAt == null || st.instMo <= 0) return st.instBal;
  return Math.max(0, st.instBal - st.instMo * monthsElapsed(st.setupAt, now));
}

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
  now: Date = new Date(),
): CardPosition {
  const st = { ...EMPTY, ...(s.cardSetup ?? {}) };
  const { stmt0, unbilled0, instMo } = st;
  const instBal = amortizedInstBal(st, now);

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

export interface CardCarryover {
  /**
   * Unbilled card spending dated inside the current cycle. This is ALREADY
   * counted as ordinary expenses in the cycle's spending total, so deducting
   * it from the salary again would charge the same dirhams twice.
   */
  unbilledCycle: number;
  /**
   * Unbilled card spending carried in from before the cycle — the opening
   * `unbilled0` plus any purchase made in an earlier cycle that no statement
   * has closed over yet.
   *
   * This is the piece that appears in no other total: it is not in this
   * cycle's spending, and it is not in the issued statement. Left out, it is
   * money the card will demand that the daily limit never knew about.
   */
  unbilledCarried: number;
}

/**
 * Splits unbilled card spending into the part this cycle already accounts for
 * and the part carried in from before it.
 *
 * `from` must be the same instant the cycle's spending total is summed from,
 * otherwise the two halves describe different periods and the split stops
 * adding up.
 */
export function cardCarryover(
  s: Pick<Ledger, 'cardSetup' | 'cardAdj' | 'cardCfg' | 'tx'>,
  from: number,
  now: Date = new Date(),
): CardCarryover {
  const { unbilled } = cardPosition(s, now);
  const spentOnCard = s.tx
    .filter((x) => posts(x) && x.type === 'expense' && x.acct === 'card' && x.ts >= from)
    .reduce((a, x) => a + x.amt, 0);

  // Payments land on the statement first and only the leftover touches
  // unbilled, so a big payment can leave less unbilled than was spent this
  // cycle. Clamping keeps the two parts summing to `unbilled` exactly.
  const unbilledCycle = Math.min(unbilled, spentOnCard);
  return { unbilledCycle, unbilledCarried: Math.max(0, unbilled - unbilledCycle) };
}

export interface CardClaim {
  // ---- charged against THIS month's salary, via the daily limit ----------
  /** Last cycle's issued statement, payable now. */
  statement: number;
  /** This month's installment charge. */
  installment: number;
  /** Unbilled spending carried in from before this cycle. */
  carried: number;
  /** statement + installment + carried — the figure the living pool loses. */
  due: number;

  // ---- charged this month, but counted elsewhere -------------------------
  /**
   * This cycle's own card spending. Real, charged, and already sitting in the
   * cycle's expense total — which is why it is not in `due`.
   */
  cycleUnbilled: number;

  // ---- owed, but legitimately deferred -----------------------------------
  /** The installment plan's remaining balance. */
  installmentBalance: number;
  /** Installment balance beyond this month's charge, spread over later months. */
  deferred: number;
  /**
   * True when an installment balance exists but no monthly charge was ever
   * declared. The plan then defers the WHOLE balance with no schedule behind
   * it — the one way the card can still hold money this app cannot see.
   */
  installmentUnknown: boolean;

  // ---- totals ------------------------------------------------------------
  /** Everything the card is owed: revolving balance plus installment plan. */
  totalOwed: number;
  /** Everything this month's salary is charged for, counted exactly once. */
  chargedThisMonth: number;
}

/**
 * The complete statement of what the credit card claims, and when.
 *
 * The point is auditability. Every dirham the card holds lands in exactly one
 * of three places — deducted from this month's limit, already counted as this
 * cycle's spending, or deferred to later months — and the three add back up to
 * the total owed. Anything that cannot be placed shows up as
 * `installmentUnknown` rather than quietly rounding to zero, because a
 * liability the app silently ignores is worse than one it admits it cannot
 * schedule.
 */
export function cardClaim(
  s: Pick<Ledger, 'cardSetup' | 'cardAdj' | 'cardCfg' | 'tx'>,
  cycleFrom: number,
  now: Date = new Date(),
): CardClaim {
  const cc = cardPosition(s, now);
  const { unbilledCycle, unbilledCarried } = cardCarryover(s, cycleFrom, now);

  const due = cc.stmtRem + cc.instMo + unbilledCarried;
  const deferred = Math.max(0, cc.instBal - cc.instMo);

  return {
    statement: cc.stmtRem,
    installment: cc.instMo,
    carried: unbilledCarried,
    due,
    cycleUnbilled: unbilledCycle,
    installmentBalance: cc.instBal,
    deferred,
    installmentUnknown: cc.instBal > 0 && cc.instMo <= 0,
    totalOwed: cc.stmtRem + cc.unbilled + cc.instBal,
    chargedThisMonth: due + unbilledCycle,
  };
}
