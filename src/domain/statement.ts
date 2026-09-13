import { posts } from './balances';
import { cardPosition } from './card';
import type { Ledger } from './types';

/**
 * The credit card's statement lifecycle.
 *
 * The card screen asks for the statement day and the payment due day, stores
 * them, and shows them back — and until now nothing computed anything from
 * either. They were settings the user filled in that the app did not use.
 *
 * This does not change what is owed. `cardPosition` already accounts for every
 * dirham and `cardCarryover` already separates spending this cycle has counted
 * from spending carried in, so the money was right. What was missing is WHEN:
 * which purchases the closed statement covers, what it demands, by what date,
 * and how long is left to pay it.
 *
 * The distinction matters because the statement boundary is not the salary
 * boundary. With a statement closing on the 3rd, a purchase on the 1st belongs
 * to the statement that has already closed, while the salary cycle counts it
 * as this month's. Treating the two as the same date is right only when the
 * card closes on the 1st, which is a default, not a fact.
 */

export interface StatementCycle {
  /** The day of the month the statement closes, as configured. */
  closeDay: number;
  /** The day of the month payment is due, as configured. */
  dueDay: number;

  /** When the most recent statement closed. */
  closedAt: Date;
  /** When the period that statement covers began — the close before it. */
  openedAt: Date;
  /** When the next statement closes. */
  closesNext: Date;
  /** When the closed statement must be paid. */
  dueAt: Date;

  /** Days from now until payment is due. Negative once it has passed. */
  daysToDue: number;
  /** True when the due date has passed and something is still outstanding. */
  overdue: boolean;
  /** Days until the current period closes. */
  daysToClose: number;

  /**
   * What the closed statement demands: spending it covers that is still
   * unpaid, plus the installment charge that bills with it.
   */
  billed: number;
  /**
   * Card spending since the statement closed. Real and already owed, but not
   * yet demanded — it bills on `closesNext`.
   */
  sinceClose: number;
  /** `billed` + `sinceClose` + the deferred installment balance. */
  totalOwed: number;
}

/** The date `day` falls on in the month of `ref`, clamped to that month's length. */
function dayIn(ref: Date, day: number): Date {
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  return new Date(ref.getFullYear(), ref.getMonth(), Math.min(Math.max(1, day), last));
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Whole days between two instants, by calendar date rather than by hours. */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 864e5);
}

export function statementCycle(
  s: Pick<Ledger, 'cardSetup' | 'cardAdj' | 'cardCfg' | 'tx'>,
  now: Date = new Date(),
): StatementCycle {
  const closeDay = Math.min(28, Math.max(1, s.cardCfg.closeDay || 1));
  const dueDay = Math.min(28, Math.max(1, s.cardCfg.dueDay || 25));

  /*
   * The statement closes at the END of its day, so a purchase made on the
   * closing day itself is still on that statement. `closedAt` is therefore the
   * start of the day AFTER the close, which is the instant the next period
   * begins — and comparing a purchase's timestamp against it needs no special
   * case for the boundary day.
   */
  const thisMonthsClose = dayIn(now, closeDay);
  const closedDay =
    now.getDate() > closeDay ? thisMonthsClose : dayIn(addMonths(now, -1), closeDay);
  const closedAt = new Date(closedDay.getFullYear(), closedDay.getMonth(), closedDay.getDate() + 1);
  const openedDay = dayIn(addMonths(closedDay, -1), closeDay);
  const openedAt = new Date(openedDay.getFullYear(), openedDay.getMonth(), openedDay.getDate() + 1);
  const closesNext = dayIn(addMonths(closedDay, 1), closeDay);

  /*
   * Payment falls in the same month as the close when the due day comes after
   * it, and in the following month otherwise — a card closing on the 25th and
   * due on the 10th is due on the 10th of the NEXT month, not two weeks before
   * the statement it pays for existed.
   */
  const dueAt = dueDay > closeDay ? dayIn(closedDay, dueDay) : dayIn(addMonths(closedDay, 1), dueDay);

  const cc = cardPosition(s, now);

  // Card spending dated after the close is on the next statement, not this one.
  const sinceClose = s.tx
    .filter(
      (x) =>
        posts(x) && x.type === 'expense' && x.acct === 'card' && x.ts >= closedAt.getTime(),
    )
    .reduce((a, x) => a + x.amt, 0);

  /*
   * What the closed statement still demands.
   *
   * Everything the card revolves — the issued statement plus unbilled spending
   * — less the part of that spending which post-dates the close, plus the
   * installment that bills alongside it. Floored at zero: paying more than the
   * statement asked for does not make the card owe the user money.
   */
  const revolvingBilled = Math.max(0, cc.stmtRem + cc.unbilled - sinceClose);
  const billed = revolvingBilled + cc.instMo;

  const daysToDue = daysBetween(now, dueAt);

  return {
    closeDay,
    dueDay,
    closedAt,
    openedAt,
    closesNext,
    dueAt,
    daysToDue,
    overdue: daysToDue < 0 && billed > 0,
    daysToClose: daysBetween(now, closesNext),
    billed,
    sinceClose,
    totalOwed: cc.stmtRem + cc.unbilled + cc.instBal,
  };
}
