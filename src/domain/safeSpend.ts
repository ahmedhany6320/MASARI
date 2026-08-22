import { bankBalance, cashBalance } from './balances';
import { cardPosition, type CardPosition } from './card';
import { goalsMonthlyRequirement } from './goals';
import type { Ledger } from './types';

export interface SafeSpend {
  bank: number;
  cash: number | null;
  /** Bank + cash. Card headroom is credit, not money, so it is excluded. */
  liquid: number;
  /** Already earmarked for goals. */
  protectedAlloc: number;
  /** Unpaid, unpaused commitments this cycle. */
  commitObl: number;
  /** Everything the card will demand: statement + unbilled + this month's installment. */
  cardObl: number;
  /**
   * What the card actually takes OUT of this month's salary: the statement
   * issued for last cycle plus this month's installment. This is deducted from
   * the living pool; `cardObl` is the wider display figure.
   */
  cardDue: number;
  /** Planned international transfers. */
  planT: number;
  /** Monthly goal contribution required. */
  goalReq: number;
  /** Salary left for living after every fixed claim. */
  livingPool: number;
  /** Spent this cycle. */
  cycleSpend: number;
  /** Living pool still unspent. */
  spendable: number;
  /** Spent today. */
  flexToday: number;
  /** Today's even-pace share of what is left. */
  allowance: number;
  /** THE number: what is still safe to spend today. */
  ssl: number;
  /** How far today has already run past its allowance. */
  overToday: number;
  /** What tomorrow looks like if today stops here. */
  tomorrow: number;
  daysLeft: number;
  /** Days already elapsed in the cycle. */
  daysElapsed: number;
  nextPay: Date;
  dayStart: number;
  cc: CardPosition;
}

/**
 * The Safe Spend Limit.
 *
 * The key modelling decision, inherited from the prototype: the daily limit is
 * driven by the SALARY CYCLE, not by the bank balance. Day-to-day spending
 * runs on the credit card while the bank balance is goal capital — it only
 * moves for international transfers, people's debts and the card settlement.
 * Sizing the daily limit off the balance would therefore invite the user to
 * spend money that is already spoken for.
 *
 *     livingPool = salary − commitments − planned transfers
 *                         − goal contribution − card due this month
 *     spendable  = livingPool − spent so far this cycle
 *     allowance  = (spendable + spentToday) / daysToPayday
 *     ssl        = allowance − spentToday
 *
 * `spentToday` is added back before dividing and subtracted after so that
 * today's allowance is computed as though the day had not started yet.
 * Without that, every purchase would shrink the same day's own budget twice.
 *
 * `now` is injected rather than read from the clock so this stays pure and
 * testable — the prototype called `new Date()` inline and could not be tested
 * at all.
 */
export function safeSpend(s: Ledger, fx: number, now: Date = new Date()): SafeSpend {
  const Y = now.getFullYear();
  const M = now.getMonth();
  const dom = now.getDate();

  // Salary lands on the 1st, so the cycle always ends at the next month's 1st.
  const nextPay = new Date(Y, M + 1, 1);
  const daysLeft = Math.max(1, Math.round((nextPay.getTime() - now.getTime()) / 864e5));
  const dayStart = new Date(Y, M, dom).getTime();
  const monthStart = new Date(Y, M, 1).getTime();

  const bank = bankBalance(s);
  const cash = cashBalance(s);
  const liquid = bank + (cash ?? 0);

  const protectedAlloc = s.goals.reduce((a, g) => a + g.alloc, 0);
  const commitObl = s.commits
    .filter((c) => !c.paused && !c.paidMonth && (c.amt ?? 0) > 0)
    .reduce((a, c) => a + (c.amt ?? 0), 0);

  const cc = cardPosition(s);
  const cardObl = cc.stmtRem + cc.unbilled + cc.instMo;

  /*
   * What the card genuinely claims from THIS month's salary.
   *
   *  - `stmtRem` is last cycle's statement, issued and payable now. That
   *    spending happened in a PREVIOUS cycle, so it is nowhere in this
   *    cycle's `cycleSpend` — leaving it out made it invisible, and the app
   *    handed back money that was already committed to the bank.
   *  - `instMo` is this month's installment charge: a real, dated outflow.
   *
   * `unbilled` is deliberately NOT deducted. That is this cycle's card
   * spending, already counted as expenses in `cycleSpend`; subtracting it
   * here as well would charge the same dirhams to the user twice.
   */
  const cardDue = cc.stmtRem + cc.instMo;

  const planT = s.planTf.reduce((a, p) => a + p.amt, 0);
  const goalReq = goalsMonthlyRequirement(s.goals, fx);

  /*
   * A baseline set during THIS cycle means the user declared their real
   * position part-way through the month: spending before that moment is
   * already reflected in the balances they stated, so it is taken from
   * `cycleSpentBefore` rather than re-summed from the ledger. Counting both
   * would charge that spending twice; counting neither would hand back a full
   * month's allowance on day 16.
   */
  const baseTs = s.baseline && s.baseline.ts >= monthStart ? s.baseline.ts : null;
  const spentBefore = baseTs != null ? (s.baseline?.cycleSpentBefore ?? 0) : 0;
  const countFrom = baseTs != null ? Math.max(monthStart, baseTs) : monthStart;

  const cycleSpend =
    spentBefore +
    s.tx
      .filter((x) => x.type === 'expense' && x.ts >= countFrom)
      .reduce((a, x) => a + x.amt, 0);

  const livingPool = s.base - commitObl - planT - goalReq - cardDue;
  const spendable = livingPool - cycleSpend;

  // Today's spending is likewise counted only from the baseline forward.
  const todayFrom = baseTs != null ? Math.max(dayStart, baseTs) : dayStart;
  const flexToday = s.tx
    .filter((x) => x.type === 'expense' && x.ts >= todayFrom)
    .reduce((a, x) => a + x.amt, 0);

  // An overspent cycle yields no allowance at all rather than a negative one:
  // the honest answer is "nothing is safe to spend", not a number to chase.
  const allowance = spendable > 0 ? (spendable + flexToday) / daysLeft : 0;
  const ssl = Math.max(0, allowance - flexToday);
  const overToday = Math.max(0, flexToday - allowance);
  const tomorrow = Math.max(0, spendable) / Math.max(1, daysLeft - 1);

  return {
    bank,
    cash,
    liquid,
    protectedAlloc,
    commitObl,
    cardObl,
    cardDue,
    planT,
    goalReq,
    livingPool,
    cycleSpend,
    spendable,
    flexToday,
    allowance,
    ssl,
    overToday,
    tomorrow,
    daysLeft,
    daysElapsed: dom,
    nextPay,
    dayStart,
    cc,
  };
}

export interface SavingSummary {
  incomeM: number;
  spendM: number;
  /** Income minus outgoings this month. */
  actual: number;
  target: number | null;
  /** Above target, when a target is set. */
  extra: number | null;
  /** Below target, when a target is set. */
  short: number | null;
}

/**
 * This month's saving against target.
 *
 * A `remit` earmarked `goal` is excluded from spending — moving money toward a
 * goal is saving it, not spending it. Every other remittance counts as an
 * outgoing.
 */
export function savingSummary(s: Ledger, now: Date = new Date()): SavingSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Deliberately NOT filtered by `posts`: `post: false` means "already inside
  // the opening balance", which is a statement about balance arithmetic, not
  // about whether the money was earned or spent this month. The opening salary
  // is exactly this case — it must still count as income here.
  const inMonth = s.tx.filter((x) => x.ts >= monthStart);
  const incomeM = inMonth
    .filter((x) => x.type === 'income')
    .reduce((a, x) => a + x.amt, 0);
  const spendM = inMonth
    .filter((x) => x.type === 'expense' || (x.type === 'remit' && x.purpose !== 'goal'))
    .reduce((a, x) => a + x.amt, 0);

  const actual = incomeM - spendM;
  const target = s.savTarget;
  const hasTarget = target != null && target > 0;

  return {
    incomeM,
    spendM,
    actual,
    target,
    extra: hasTarget ? Math.max(0, actual - target) : null,
    short: hasTarget ? Math.max(0, target - actual) : null,
  };
}
