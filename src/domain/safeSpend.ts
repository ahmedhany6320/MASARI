import { bankBalance, cashBalance } from './balances';
import { cardCarryover, cardClaim, cardPosition, type CardClaim, type CardPosition } from './card';
import {
  adaptDaily,
  adaptTarget,
  livingBand,
  type DailyAdaptation,
  type LivingBand,
  type TargetAdaptation,
} from './adaptiveDaily';
import { commitmentsDue, type CommitmentsDue } from './commitments';
import { varianceReport, type VarianceReport } from './variance';
import { fundedGoals, fundGoals, type FundingPlan } from './funding';
import { goalsMonthlyRequirement } from './goals';
import {
  projectAtPace,
  spendPlan,
  steeringGoal,
  type PlanInputs,
  type SpendPlan,
} from './spendPlan';
import type { Goal, Ledger } from './types';

export interface SafeSpend {
  bank: number;
  cash: number | null;
  /** Bank + cash. Card headroom is credit, not money, so it is excluded. */
  liquid: number;
  /** Money standing behind goals, after auto goals draw on the balance. */
  protectedAlloc: number;
  /** Which goal each dirham of the balance is serving. */
  funding: FundingPlan;
  /**
   * The goals with `alloc` resolved to what actually backs them. Screens and
   * calculations should read these rather than `ledger.goals`, whose `alloc`
   * is meaningless for a goal funded from the balance.
   */
  goals: Goal[];
  /** Commitments still owed this cycle, after date and paid-status checks. */
  commitObl: number;
  /** Every commitment's standing this cycle: due date, state, what it claims. */
  commitments: CommitmentsDue;
  /**
   * Planned versus actual on every obligation, and the surplus or shortfall
   * that difference hands to the goal.
   */
  variance: VarianceReport;
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
  /**
   * Cash reserve held back this month, ahead of any goal.
   *
   * The floor protects an AVERAGE day; this protects the days that are not
   * average. Without it the goal takes every dirham above the floor, and the
   * first irregular expense lands on an account that the plan reported as
   * healthy — the failure that makes the whole plan untrustworthy.
   */
  bufferReq: number;
  /** The reserve's target, as declared. Zero when none is set. */
  bufferTarget: number;
  /** Already held against it: liquid not claimed by a goal. */
  bufferHeld: number;
  /** Still to be set aside. Zero once it is full. */
  bufferShort: number;
  /** True once the reserve is fully funded and stops taking a share. */
  bufferFunded: boolean;
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
  /** The declared living band: survival floor and balanced level. */
  band: LivingBand;
  /**
   * The daily control loop's reading. Present whenever a band is declared —
   * this is what makes the figure answer back to real spending instead of
   * restating the plan.
   */
  daily: DailyAdaptation | null;
  /** What the steering goal is actually worth at the current pace. */
  targetAdapted: TargetAdaptation | null;
  /**
   * THE monthly contribution to the goal: its reserved share, plus the half of
   * any underspend the daily loop banked, plus whatever obligations left over
   * by coming in under budget.
   *
   * Every projection anywhere in the app must be built from this one figure.
   * Five functions used to answer "where does the goal land", each from a
   * slightly different input, and on one real ledger they produced 433,894,
   * 409,958, 407,261, null and NaN — with two of those on the same screen.
   */
  goalMonthly: number;
  /** Which basis produced the figures above. */
  basis: 'salary' | 'balance' | 'goal';
  /**
   * The goal-driven plan, when one steers. Present only on the 'goal' basis,
   * where `allowance` comes from it rather than from dividing what is left.
   */
  plan: SpendPlan | null;
  /**
   * Where the steering goal lands at the pace ACTUALLY being spent, rather
   * than the pace the plan assumed. In the goal's own currency.
   */
  planProjected: number | null;
  /**
   * Exactly the inputs `plan` was built from. Exposed so callers exploring
   * alternatives — "what if I spent more" — reuse them rather than rebuilding
   * them and quietly disagreeing with the plan on screen beside them.
   */
  planInputs: PlanInputs | null;
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
  /*
   * The reserve is taken off the top of the balance, before any goal draws on
   * it. A goal funded from the emergency fund is not funded — it is the same
   * money counted twice, and the first irregular expense reveals it.
   */
  const bufferTarget = Math.max(0, s.bufferTarget ?? 0);
  const bufferHeld = Math.min(bufferTarget, Math.max(0, liquid));
  const bufferShort = Math.max(0, bufferTarget - bufferHeld);
  const bufferFunded = bufferShort <= 0;

  const funding = fundGoals(s.goals, liquid - bufferHeld, fx);
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
   * What obligations actually cost, against what they were budgeted. The
   * difference is the goal's in both directions: a bill that came in under
   * plan leaves money the salary had already given up, and one that came in
   * over has to be paid for from somewhere.
   */
  const variance = varianceReport(s, now);

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

  /*
   * Two floors, and they do different jobs.
   *
   * PLANNING aims at the comfortable end, because a plan that targets bare
   * survival from the outset hands the goal money the user was never going to
   * be willing to give it, and reports a month of endurance as the intended
   * outcome. The app aims high and lets pressure push it down.
   *
   * The SURVIVAL end is the hard stop, enforced by the daily loop below. It is
   * the one figure nothing is allowed to breach — not the goal, not an
   * overspent month, not the arithmetic.
   */
  const band = livingBand(s.minDailySpend, s.comfortDailySpend);
  const hasBand = band.min > 0 || band.comfort > 0;
  const planFloorDaily = band.comfort > 0 ? band.comfort : Math.max(0, s.minDailySpend ?? 0);
  const floorMonthly = planFloorDaily * daysInMonth;
  const basisPool = s.sslBasis === 'balance' ? bank + (cash ?? 0) : s.base;
  const poolBeforeGoal = basisPool - commitObl - planT - cardDue;
  const goals = fundedGoals(funding);
  const goalAsked = goalsMonthlyRequirement(goals, fx);

  /*
   * On the goal basis the goal stops being a claim and becomes the residual:
   * the plan fixes what may be spent per day, and everything the month does
   * not spend goes to the goal. So `goalReq` is derived from the spending
   * decision rather than competing with it.
   */
  // Spread over six months, and never at the expense of the living floor.
  const bufferWanted = bufferShort / 6;
  const bufferReq = Math.min(bufferWanted, Math.max(0, poolBeforeGoal - floorMonthly));

  const poolAfterBuffer = Math.max(0, poolBeforeGoal - bufferReq);

  const steering = steeringGoal(goals);
  const planInputs: PlanInputs | null =
    steering != null
      ? {
          // The pool the goal can actually draw on: the reserve is filled
          // first, so planning against the pre-reserve figure would promise a
          // landing point the goal never receives the money to reach.
          poolBeforeGoal: poolAfterBuffer,
          daysInMonth,
          heldAed: steering.alloc,
          floorDaily: planFloorDaily,
          fx,
        }
      : null;
  const plan = steering != null && planInputs != null ? spendPlan(steering, planInputs) : null;

  /*
   * A goal with both a target and a duration steers by default. Someone who
   * sets both is asking exactly this question — "what do I spend to get
   * there" — and making them find a setting first means they never see the
   * answer. An explicit `sslBasis` overrides it either way.
   */
  const planSteers = plan != null && (s.sslBasis == null || s.sslBasis === 'goal');

  /*
   * The reserve is filled BEFORE the goal, never after.
   *
   * Ordering is the whole point. A goal that takes everything above the daily
   * floor leaves nothing for the days that exceed it, so the plan reads
   * healthy right up until something breaks and the money is not there.
   * Filling the reserve first costs the goal time and costs nothing else; the
   * reverse costs the user the ability to pay for a bad week.
   *
   * It is a STOCK, not a permanent tax: once `bufferHeld` reaches the target
   * the contribution falls to zero on its own and the goal gets the full
   * surplus again.
   */
  const goalReq = planSteers
    ? plan.monthlyToGoal
    : Math.min(goalAsked, Math.max(0, poolAfterBuffer - floorMonthly));
  // On the goal basis this reads as "how much less the goal gets than a
  // target-driven schedule would have demanded" — the price of staying livable.
  const goalHeldBack = Math.max(0, goalAsked - goalReq);

  /*
   * Commitment settlements are excluded. Paying the rent is real spending and
   * belongs in history and in the category breakdown, but the salary already
   * gave it up as a claim — charging the payment here as well would take the
   * same 1,800 out of the living allowance twice and leave the month looking
   * ruined the day the rent clears.
   */
  const cycleSpend =
    spentBefore +
    s.tx
      .filter((x) => x.type === 'expense' && x.ts >= countFrom && x.commitId == null)
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
  const basis: 'salary' | 'balance' | 'goal' = planSteers
    ? 'goal'
    : s.sslBasis === 'balance'
      ? 'balance'
      : 'salary';

  const livingPool =
    basis === 'balance'
      ? liquid - commitObl - planT - goalReq - cardDue - bufferReq
      : s.base - commitObl - planT - goalReq - cardDue - bufferReq;

  // Card spending does not touch the balance until the card is settled, and
  // that settlement is already deducted as `cardDue` — so on the balance basis
  // only the card spending of this cycle still needs charging.
  const spendable = basis === 'balance' ? livingPool - carry.unbilledCycle : livingPool - cycleSpend;

  // Today's spending is likewise counted only from the baseline forward.
  const todayFrom = baseTs != null ? Math.max(dayStart, baseTs) : dayStart;
  const flexToday = s.tx
    .filter((x) => x.type === 'expense' && x.ts >= todayFrom && x.commitId == null)
    .reduce((a, x) => a + x.amt, 0);

  /*
   * On the goal basis the daily figure is the PLAN'S, held steady for the
   * whole cycle. Dividing what is left by the days remaining — which is what
   * the other bases do — produces a number that drifts every time anything
   * else moves, and a commitment you cannot hold yourself to is not a
   * commitment. Overspending here does not raise tomorrow's limit; it lowers
   * where the goal lands, and `planProjected` says by how much.
   *
   * An overspent cycle on the other bases yields no allowance at all rather
   * than a negative one: the honest answer is "nothing is safe to spend", not
   * a number to chase.
   */
  /*
   * The control loop owns the daily figure whenever a band exists.
   *
   * It re-derives from what was ACTUALLY spent rather than restating the plan,
   * so an expensive week tightens the days that follow and a careful one loosens
   * them — while the survival floor holds regardless and the goal absorbs any
   * deficit that would otherwise breach it.
   */
  const daily = hasBand
    ? adaptDaily({
        livingBudget: Math.max(0, livingPool),
        spent: cycleSpend,
        daysElapsed: dom,
        daysLeft,
        daysInMonth,
        band,
      })
    : null;

  /*
   * The single figure every projection is built from. Assembled here, once,
   * so no caller can reconstruct a slightly different version of it.
   */
  const goalMonthly = goalReq + (daily?.bankedToGoal ?? 0) + variance.toGoal;

  const allowance = daily
    ? daily.today
    : planSteers
      ? plan.dailyAllowance
      : spendable > 0
        ? (spendable + flexToday) / daysLeft
        : 0;
  const ssl = Math.max(0, allowance - flexToday);
  const overToday = Math.max(0, flexToday - allowance);
  const tomorrow = Math.max(0, spendable) / Math.max(1, daysLeft - 1);

  return {
    bank,
    cash,
    liquid,
    protectedAlloc,
    funding,
    goals,
    commitObl,
    commitments,
    variance,
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
    bufferReq,
    bufferTarget,
    bufferHeld,
    bufferShort,
    bufferFunded,
    livingPool,
    cycleSpend,
    spendable,
    flexToday,
    allowance,
    ssl,
    basis,
    band,
    daily,
    goalMonthly,
    targetAdapted:
      steering != null
        ? adaptTarget(steering, goalMonthly, steering.months ?? 0, steering.alloc, fx)
        : null,
    plan,
    planInputs,
    planProjected:
      plan != null && steering != null
        ? projectAtPace(plan, steering, steering.alloc, cycleSpend, poolAfterBuffer, fx)
        : null,
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
