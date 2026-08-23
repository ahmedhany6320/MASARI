import { bankBalance, cashBalance } from './balances';
import { cardCarryover, cardClaim, cardPosition, type CardClaim, type CardPosition } from './card';
import { commitmentsDue, type CommitmentsDue } from './commitments';
import { fundGoals, type FundingPlan } from './funding';
import { goalsMonthlyRequirement } from './goals';
import type { Ledger } from './types';

export interface SafeSpend {
  bank: number;
  cash: number | null;
  /** Bank + cash. Card headroom is credit, not money, so it is excluded. */
  liquid: number;
  /** Money standing behind goals, after auto goals draw on the balance. */
  protectedAlloc: number;
  /** Which goal each dirham of the balance is serving. */
  funding: FundingPlan;
  /** Commitments still owed this cycle, after date and paid-status checks. */
  commitObl: number;
  /** Every commitment's standing this cycle: due date, state, what it claims. */
  commitments: CommitmentsDue;
  /** Everything the card will demand: statement + unbilled + this month's installment. */
  cardObl: number;
  /**
   * What the card takes OUT of this month's salary: the issued statement, this
   * month's installment, and unbilled spending carried in from before the
   * cycle. Deducted from the living pool; `cardObl` is the wider display
   * figure.
   */
  cardDue: number;
  /** `cardDue` itemised, so the breakdown can show its working. */
  cardDueParts: {
    /** Last cycle's issued statement, still unpaid. */
    statement: number;
    /** This month's installment charge. */
    installment: number;
    /** Unbilled spending from before this cycle — the piece nothing else counts. */
    carried: number;
  };
  /**
   * This cycle's own card spending. Already inside `cycleSpend`, so it is NOT
   * in `cardDue` — surfaced only so the breakdown can say where it went.
   */
  cardCycleUnbilled: number;
  /** The full, auditable statement of what the card claims and when. */
  cardClaim: CardClaim;
  /** Planned international transfers. */
  planT: number;
  /** Monthly goal contribution actually reserved, after protecting the floor. */
  goalReq: number;
  /** What the goal schedule asked for before the floor capped it. */
  goalAsked: number;
  /** How much the living floor held back from the goal. */
  goalHeldBack: number;
  /** The declared living floor, per month. Zero when none is set. */
  floorMonthly: number;
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
  /** Which basis produced the figures above. */
  basis: 'salary' | 'balance';
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

  /*
   * Auto goals draw their progress from the balance rather than from a figure
   * typed by hand, so what a goal holds — and therefore what it still needs
   * each month — has to be resolved before the requirement is worked out.
   */
  const funding = fundGoals(s.goals, liquid, fx);
  const protectedAlloc = funding.funded;
  /*
   * Commitments are scheduled rather than summed. The old filter deducted
   * every unpaid one regardless of date, and trusted a `paidMonth` flag that
   * nothing ever cleared — so a bill ticked once left the daily limit
   * permanently. `commitmentsDue` re-decides both every cycle.
   */
  const commitments = commitmentsDue(s.commits, now);
  const commitObl = commitments.total;

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

  const cc = cardPosition(s, now);
  const cardObl = cc.stmtRem + cc.unbilled + cc.instMo;
  const carry = cardCarryover(s, countFrom, now);

  /*
   * What the card claims from THIS month's salary.
   *
   * Every dirham the card holds must be charged to the user exactly once —
   * never zero times, never twice. Three parts, three different reasons:
   *
   *  - `stmtRem` is last cycle's statement, issued and payable now. That
   *    spending happened in a PREVIOUS cycle, so it is nowhere in this
   *    cycle's `cycleSpend`. It is deducted here.
   *  - `instMo` is this month's installment charge: a real, dated outflow.
   *    Deducted here.
   *  - `carry.unbilledCarried` is spending sitting on the card from before
   *    this cycle that no statement has closed over yet — the opening
   *    `unbilled0` and any earlier-cycle purchase. It is in NO other total,
   *    so leaving it out was a genuine hole: the card was quietly holding
   *    money the daily limit had already handed back. Deducted here.
   *
   * `carry.unbilledCycle` is the one part deliberately NOT deducted. That is
   * this cycle's own card spending, already counted as expenses inside
   * `cycleSpend`; subtracting it here as well would charge it twice and halve
   * the limit on every card purchase.
   */
  const cardDue = cc.stmtRem + cc.instMo + carry.unbilledCarried;

  const planT = s.planTf.reduce((a, p) => a + p.amt, 0);

  /*
   * Goals may only claim what is left once the living floor is safe.
   *
   * Without this cap an ambitious target quietly drives the daily limit toward
   * zero, which is arithmetically correct and practically useless — nobody
   * lives on it, so they stop trusting the number entirely. Capping means the
   * GOAL slips rather than the person going hungry, and the goal screen shows
   * exactly how far it slipped and why.
   */
  const daysInMonth = new Date(Y, M + 1, 0).getDate();
  const floorMonthly = Math.max(0, s.minDailySpend ?? 0) * daysInMonth;
  const basisPool = s.sslBasis === 'balance' ? bank + (cash ?? 0) : s.base;
  const poolBeforeGoal = basisPool - commitObl - planT - cardDue;
  const goalAsked = goalsMonthlyRequirement(s.goals, fx, (g) =>
    funding.goals.find((x) => x.goal.id === g.id)?.held ?? g.alloc,
  );
  const goalReq = Math.min(goalAsked, Math.max(0, poolBeforeGoal - floorMonthly));
  const goalHeldBack = Math.max(0, goalAsked - goalReq);

  const cycleSpend =
    spentBefore +
    s.tx
      .filter((x) => x.type === 'expense' && x.ts >= countFrom)
      .reduce((a, x) => a + x.amt, 0);

  /*
   * Two ways to size the pool, and the right one depends on what the app
   * actually knows.
   *
   * On the SALARY basis the pool is the salary less every claim, and spending
   * so far this cycle is then subtracted. That needs the app to have seen the
   * whole cycle; start it on the 14th and it hands back a full month's budget
   * for a salary that is already half spent.
   *
   * On the BALANCE basis the money in hand IS the answer. It is a measured
   * fact rather than a reconstruction, so nothing needs subtracting for
   * history — what was spent is already missing from the balance. The salary
   * still matters, but only for saying when the next one arrives.
   *
   * Both then hand the same figure to the same divider below, so everything
   * downstream — allowance, overspend, tomorrow — is untouched by the choice.
   */
  const basis: 'salary' | 'balance' = s.sslBasis === 'balance' ? 'balance' : 'salary';

  const livingPool =
    basis === 'balance'
      ? liquid - commitObl - planT - goalReq - cardDue
      : s.base - commitObl - planT - goalReq - cardDue;

  // Card spending does not touch the balance until the card is settled, and
  // that settlement is already deducted as `cardDue` — so on the balance basis
  // only the card spending of this cycle still needs charging.
  const spendable = basis === 'balance' ? livingPool - carry.unbilledCycle : livingPool - cycleSpend;

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
    funding,
    commitObl,
    commitments,
    cardObl,
    cardDue,
    cardDueParts: {
      statement: cc.stmtRem,
      installment: cc.instMo,
      carried: carry.unbilledCarried,
    },
    cardCycleUnbilled: carry.unbilledCycle,
    cardClaim: cardClaim(s, countFrom, now),
    planT,
    goalReq,
    goalAsked,
    goalHeldBack,
    floorMonthly,
    livingPool,
    cycleSpend,
    spendable,
    flexToday,
    allowance,
    ssl,
    basis,
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
