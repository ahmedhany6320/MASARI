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
 * How much of the installment plan has been BILLED so far.
 *
 * A plan charges one installment per month, so time governs what can be
 * demanded — but never what has been settled. Without a setup date there is no
 * elapsed time to measure, so the whole plan is treated as billable and
 * payment alone decides.
 */
export function instBilled(st: Required<CardSetup>, now: Date): number {
  if (st.instMo <= 0) return 0;
  if (st.setupAt == null) return st.instBal;
  // The month of setup carries a charge of its own, hence the +1.
  return Math.min(st.instBal, st.instMo * (monthsElapsed(st.setupAt, now) + 1));
}

/**
 * The installment balance as it stands today.
 *
 * Two wrong answers were rejected on the way here. Leaving the figure static —
 * as it was originally — showed the same plan balance in month one and month
 * twelve, so paying it down never appeared anywhere. Amortising purely by
 * elapsed months was no better: it retires installments for someone who has
 * paid nothing, which is precisely backwards for an app whose job is to say
 * what is still owed.
 *
 * So the plan comes down only when it is PAID. Payments settle the issued
 * statement first, then the installments billed to date, and anything beyond
 * that reduces unbilled spending — the order a card bill is actually presented
 * in, and the order the user described.
 */
export function instPaidOff(st: Required<CardSetup>, paid: number, now: Date): number {
  const beyondStatement = Math.max(0, paid - st.stmt0);
  return Math.min(instBilled(st, now), beyondStatement);
}

export function amortizedInstBal(st: Required<CardSetup>, paid: number, now: Date): number {
  if (st.instMo <= 0) return st.instBal;
  return Math.max(0, st.instBal - instPaidOff(st, paid, now));
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

  /*
   * The payment waterfall: statement, then the installments billed so far,
   * then unbilled spending. Only what survives all three reduces the running
   * balance, so an ordinary monthly payment retires an installment instead of
   * silently shrinking unbilled spending it was never meant to cover.
   */
  const instPaid = instPaidOff(st, paid, now);
  const instBal = Math.max(0, st.instBal - instPaid);
  const leftover = Math.max(0, paid - stmt0 - instPaid);
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
   * The bill standing right now: the issued statement plus this month's
   * installment. What settling the card today would cost.
   */
  billNow: number;
  /**
   * What the card will bill next: everything unbilled so far, plus the
   * installment that keeps running.
   */
  billNext: number;
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
    billNow: cc.stmtRem + cc.instMo,
    billNext: cc.unbilled + cc.instMo,
    totalOwed: cc.stmtRem + cc.unbilled + cc.instBal,
    chargedThisMonth: due + unbilledCycle,
  };
}
