import { bankBalance, cashBalance } from './balances';
import { cardPosition } from './card';
import { commitmentsDue } from './commitments';
import { cycleKey } from './commitments';
import { isEgpGoal } from './goals';
import type { Goal, Ledger } from './types';

/**
 * The single cash-flow projection everything else reads from.
 *
 * WHAT THIS REPLACES, AND WHY THE OLD VERSION WAS WRONG
 *
 * The daily figure used to be a one-line residual computed inside a single
 * month:
 *
 *     livingPool = salary − commitments − transfers − cardDue − goal − buffer
 *     spendable  = livingPool − spentThisCycle
 *     allowance  = spendable ÷ daysLeft
 *
 * Four things are wrong with that.
 *
 * It never looks past the current month, so it cannot answer whether the goal
 * is reachable by its date — the question the whole app exists for. It can
 * only ever say what is left of THIS salary.
 *
 * It treats the goal as a CLAIM competing with living rather than as the
 * OUTCOME of a plan, so an ambitious target drives the daily figure toward
 * zero and the app produces a number nobody can live on.
 *
 * It counts the credit card twice in spirit: `cardDue` is subtracted as a
 * future settlement while card purchases are simultaneously counted in
 * `spentThisCycle`. Patching that with a carried/cycle split works but leaves
 * the same fragile structure — two expenses for one movement of money.
 *
 * And it is balance-blind: it starts from the salary, so money already held
 * and debt already owed change nothing until they happen to move.
 *
 * WHAT REPLACES IT
 *
 * A month-by-month simulation of NET POSITION from today to the target date.
 * Net position is bank plus cash minus everything owed on the card, and using
 * it dissolves the double-counting problem rather than patching it:
 *
 *   - a card purchase raises card debt, so net position falls once, when the
 *     money is committed;
 *   - settling the card lowers the bank and lowers the debt by the same
 *     amount, so net position does not move at all — correctly, because
 *     settling a card makes nobody poorer.
 *
 * Rent and international transfers leave the bank immediately and so reduce
 * net position on the day they go. Food and transport land on the card and
 * reduce it the moment they are charged. One movement, one effect, no
 * reconciliation needed.
 *
 * The daily figure is then DERIVED from the monthly discretionary budget the
 * projection settles on, rather than being the thing computed first.
 */

/** The range a life is actually lived in, not a punishment floor. */
export interface LifestyleRange {
  /** The least that is survivable for a stretch. */
  min: number;
  /** An ordinary, sustainable day. Projections assume this. */
  comfort: number;
}

export interface MonthProjection {
  /** 0 is the current, part-elapsed month. */
  index: number;
  month: number;
  year: number;
  /** Net position entering the month. */
  openingNet: number;
  /** Salary plus any confirmed incoming money. */
  income: number;
  /** Commitments still to be paid in this month. */
  commitments: number;
  /** Planned transfers still to leave in this month. */
  transfers: number;
  /** Discretionary spending assumed for the month. */
  discretionary: number;
  /** Net position leaving the month. */
  closingNet: number;
  /** Cumulative growth in net position since today, in the salary currency. */
  accumulatedAed: number;
}

export type Feasibility =
  /** Reachable while living inside the range. */
  | 'feasible'
  /** Reachable only by living under the range for the whole term. */
  | 'unsustainable'
  /** Not reachable even spending nothing at all. */
  | 'impossible'
  /** Already there. */
  | 'met'
  /** No target or no date, so there is nothing to assess. */
  | 'unset';

export interface GoalAssessment {
  feasibility: Feasibility;
  /** The target, in the goal's own currency. */
  target: number;
  months: number;
  /** The ceiling: what is reachable spending nothing whatsoever. */
  maxReachable: number;
  /** What is reachable living at the comfortable end of the range. */
  realisticReachable: number;
  /** What is reachable living at the floor for the whole term. */
  austereReachable: number;
  /** How far the realistic projection falls short. Zero when it arrives. */
  shortfall: number;
  /** The daily spend that lands exactly on target. Null when impossible. */
  requiredDaily: number | null;
  /** Monthly saving the target implies, in the salary currency. */
  requiredMonthlyAed: number;
  /** Everything above stated in one sentence the UI can render. */
  reason: Feasibility;
}

export interface ProjectionInput {
  ledger: Ledger;
  fx: number;
  now: Date;
  range: LifestyleRange;
  /** Months to simulate. Defaults to the goal's horizon. */
  months?: number;
}

export interface Projection {
  /** Bank plus cash minus everything owed on the card, right now. */
  netNow: number;
  bank: number;
  cash: number;
  cardOutstanding: number;
  /** Salary plus confirmed income landing each month. */
  monthlyIncome: number;
  /** Commitments due in a full month. */
  monthlyCommitments: number;
  /** Planned transfers leaving in a full month. */
  monthlyTransfers: number;
  /** What a full month leaves for discretionary spending before the goal. */
  monthlyCapacity: number;
  /** The discretionary budget the plan settles on for a full month. */
  monthlyDiscretionary: number;
  range: LifestyleRange;
  months: MonthProjection[];
  assessment: GoalAssessment;
  goal: Goal | null;
}

/** Converts an amount in the salary currency into the goal's. */
function toGoalCurrency(goal: Goal | null, aed: number, fx: number): number {
  return goal != null && isEgpGoal(goal) ? aed * fx : aed;
}

/** Converts an amount in the goal's currency into the salary currency. */
function toAed(goal: Goal | null, amount: number, fx: number): number {
  return goal != null && isEgpGoal(goal) ? amount / fx : amount;
}

/**
 * Runs the month-by-month simulation at a given daily discretionary spend.
 *
 * `dailySpend` is the lever: everything else is fixed by the ledger. Running
 * it at zero gives the ceiling, at the floor gives the austere case, and at
 * the comfortable end gives the realistic one.
 */
export function simulate(
  inp: ProjectionInput,
  dailySpend: number,
  months: number,
): MonthProjection[] {
  const { ledger, now } = inp;
  const startNet = netPosition(ledger, now);

  const due = commitmentsDue(ledger.commits, now);
  const fullCommitments = ledger.commits
    .filter((k) => !k.paused)
    .reduce((a, k) => a + (k.amt ?? 0), 0);

  const cycle = cycleKey(now);
  const fullTransfers = ledger.planTf.reduce((a, tf) => a + tf.amt, 0);
  const remainingTransfers = ledger.planTf
    .filter((tf) => tf.sentFor !== cycle)
    .reduce((a, tf) => a + tf.amt, 0);

  const out: MonthProjection[] = [];
  let net = startNet;

  for (let i = 0; i < Math.max(0, months); i++) {
    const first = i === 0;
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

    /*
     * The current month is entered part-way through. Its salary has already
     * landed and is inside `netNow`, and any commitment already settled must
     * not be charged again — counting September's rent twice is exactly the
     * error this guards against. Only what REMAINS of it is simulated.
     */
    const income = first ? 0 : inp.ledger.base;
    const commitments = first ? due.total : fullCommitments;
    const transfers = first ? remainingTransfers : fullTransfers;

    const daysCounted = first ? Math.max(0, daysInMonth - now.getDate() + 1) : daysInMonth;
    const discretionary = Math.max(0, dailySpend) * daysCounted;

    const opening = net;
    const closing = opening + income - commitments - transfers - discretionary;
    net = closing;

    out.push({
      index: i,
      month: d.getMonth(),
      year: d.getFullYear(),
      openingNet: opening,
      income,
      commitments,
      transfers,
      discretionary,
      closingNet: closing,
      accumulatedAed: closing - startNet,
    });
  }

  return out;
}

/**
 * Net position: what would be left after clearing the card today.
 *
 * The figure that makes card spending and card settlement one movement rather
 * than two expenses. A purchase raises the debt and lowers this; a settlement
 * lowers the bank and the debt equally and leaves it untouched — which is
 * correct, because paying a card off makes nobody poorer.
 */
export function netPosition(
  ledger: Pick<Ledger, 'cardSetup' | 'cardAdj' | 'cardCfg' | 'tx' | 'bankOpen' | 'cashOpen' | 'lastRecStr'>,
  now: Date = new Date(),
): number {
  const cc = cardPosition(ledger, now);
  const bank = bankBalance(ledger as never);
  const cash = cashBalance(ledger as never) ?? 0;
  return bank + cash - (cc.stmtRem + cc.unbilled + cc.instBal);
}

/**
 * Assesses the goal against the projection.
 *
 * Three questions in order, because they have different answers and the app
 * has been conflating them: is it reachable AT ALL, is it reachable while
 * living, and what does it actually take.
 */
export function assess(
  inp: ProjectionInput,
  goal: Goal | null,
  months: number,
): GoalAssessment {
  const target = goal?.target ?? 0;
  const base = {
    target,
    months,
    maxReachable: 0,
    realisticReachable: 0,
    austereReachable: 0,
    shortfall: 0,
    requiredDaily: null,
    requiredMonthlyAed: 0,
  };

  if (goal == null || target <= 0 || months <= 0) {
    return { ...base, feasibility: 'unset', reason: 'unset' };
  }

  const held = goal.alloc + (isEgpGoal(goal) ? (goal.extEgp ?? 0) / inp.fx : 0);
  const endOf = (daily: number) => {
    const sim = simulate(inp, daily, months);
    const grown = sim.length > 0 ? (sim[sim.length - 1] as MonthProjection).accumulatedAed : 0;
    return toGoalCurrency(goal, held + Math.max(0, grown), inp.fx);
  };

  const maxReachable = endOf(0);
  const austereReachable = endOf(inp.range.min);
  const realisticReachable = endOf(inp.range.comfort);

  if (toAed(goal, target, inp.fx) <= held) {
    return {
      ...base, feasibility: 'met', reason: 'met',
      maxReachable, austereReachable, realisticReachable,
    };
  }

  // What the target demands per month, and the daily spend that leaves it.
  const neededAed = Math.max(0, toAed(goal, target, inp.fx) - held);
  const requiredMonthlyAed = neededAed / months;

  /*
   * The daily spend that lands exactly on target, found from the capacity the
   * simulation reveals rather than from a formula: capacity already accounts
   * for a part-elapsed first month, settled commitments and unsent transfers.
   */
  const zeroSpendGrowth = simulate(inp, 0, months);
  const totalCapacity =
    zeroSpendGrowth.length > 0
      ? (zeroSpendGrowth[zeroSpendGrowth.length - 1] as MonthProjection).accumulatedAed
      : 0;
  const totalDays = zeroSpendGrowth.reduce((a, m) => a + daysIn(m, inp.now), 0);

  const requiredDaily =
    totalDays > 0 ? (totalCapacity - neededAed) / totalDays : null;

  const shortfall = Math.max(0, target - realisticReachable);

  let feasibility: Feasibility;
  if (target > maxReachable) feasibility = 'impossible';
  else if (requiredDaily != null && requiredDaily >= inp.range.min) {
    // Reachable while living inside the range — the only genuinely good case.
    feasibility = requiredDaily >= inp.range.comfort ? 'feasible' : 'unsustainable';
  } else feasibility = 'unsustainable';

  return {
    feasibility,
    reason: feasibility,
    target,
    months,
    maxReachable,
    realisticReachable,
    austereReachable,
    shortfall,
    requiredDaily: requiredDaily != null && requiredDaily > 0 ? requiredDaily : null,
    requiredMonthlyAed,
  };
}

/** Days a simulated month actually covers. */
function daysIn(m: MonthProjection, now: Date): number {
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
  return m.index === 0 ? Math.max(0, daysInMonth - now.getDate() + 1) : daysInMonth;
}

/** Builds the whole projection. */
export function project(inp: ProjectionInput): Projection {
  const { ledger, now, range } = inp;
  const goal =
    ledger.goals.find((g) => g.target != null && g.target > 0 && !!g.months && g.months > 0) ??
    null;

  const months = Math.max(1, inp.months ?? goal?.months ?? 12);

  const cc = cardPosition(ledger, now);
  const bank = bankBalance(ledger);
  const cash = cashBalance(ledger) ?? 0;
  const cardOutstanding = cc.stmtRem + cc.unbilled + cc.instBal;

  const fullCommitments = ledger.commits
    .filter((k) => !k.paused)
    .reduce((a, k) => a + (k.amt ?? 0), 0);
  const fullTransfers = ledger.planTf.reduce((a, tf) => a + tf.amt, 0);

  const assessment = assess(inp, goal, months);

  /*
   * The discretionary budget the plan settles on.
   *
   * Feasible at the comfortable end: live there. Reachable only below it:
   * live at the required figure, but the assessment labels that unsustainable
   * rather than pretending it is a plan. Not reachable at all: there is
   * nothing to be gained by austerity, so the range is honoured and the
   * shortfall is reported instead of a punishing number nobody can hold.
   */
  const dailyTarget =
    assessment.feasibility === 'impossible' || assessment.requiredDaily == null
      ? range.comfort
      : Math.min(range.comfort, Math.max(range.min, assessment.requiredDaily));

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return {
    netNow: bank + cash - cardOutstanding,
    bank,
    cash,
    cardOutstanding,
    monthlyIncome: ledger.base,
    monthlyCommitments: fullCommitments,
    monthlyTransfers: fullTransfers,
    monthlyCapacity: ledger.base - fullCommitments - fullTransfers,
    monthlyDiscretionary: dailyTarget * daysInMonth,
    range,
    months: simulate(inp, dailyTarget, months),
    assessment,
    goal,
  };
}

/**
 * The daily figure, derived from the monthly projection rather than computed
 * on its own.
 *
 * The old formula divided what was left by the days remaining, which has two
 * failures that compound. A single expensive day collapses the next one —
 * spend 300 against a 40 plan on the 5th and the remaining days drop to a
 * figure nobody can hold, so the plan is abandoned and the app with it. And
 * since the division is exact, the number twitches every time anything moves,
 * which is not something a person can steer by.
 *
 * So the strict figure is still computed — the month does have to balance —
 * but what is SHOWN moves only part of the way toward it. A deficit is
 * recovered over a window of days instead of instantly, and the difference
 * between the smoothed figure and the strict one is charged to the goal,
 * which is the one thing in the system that can absorb it without anybody
 * going hungry.
 */
export interface DailyBudget {
  /** The even pace the month was planned at. */
  planned: number;
  /** What is left, divided by the days remaining. Exact and unliveable. */
  strict: number;
  /** The figure to act on: strict, smoothed, then held to the range. */
  today: number;
  /** Planned-to-date minus actual. Positive means under, and is capacity. */
  variance: number;
  /** Capacity freed by underspending, available across the days remaining. */
  freed: number;
  /** Overspend the goal absorbs so the floor is not breached. */
  absorbed: number;
  /** Discretionary budget left in the month. */
  remaining: number;
  daysLeft: number;
  /** True while spending is at or under plan. */
  onTrack: boolean;
  /** Where `today` sits between the floor and the comfortable end, 0–1. */
  position: number;
}

/**
 * How many days a shortfall is recovered over.
 *
 * One is the old behaviour — the whole correction lands on tomorrow. Long
 * enough and the month never balances. A week is short enough to matter and
 * long enough that a single bad day is felt as a nudge rather than a
 * punishment.
 */
export const SMOOTHING_DAYS = 7;

export function dailyBudget(args: {
  monthlyDiscretionary: number;
  spent: number;
  daysElapsed: number;
  daysLeft: number;
  daysInMonth: number;
  range: LifestyleRange;
  smoothingDays?: number;
}): DailyBudget {
  const daysLeft = Math.max(1, args.daysLeft);
  const daysInMonth = Math.max(1, args.daysInMonth);
  const budget = Math.max(0, args.monthlyDiscretionary);
  const spent = Math.max(0, args.spent);
  const window = Math.max(1, args.smoothingDays ?? SMOOTHING_DAYS);

  const planned = budget / daysInMonth;

  // Measured against days that have FINISHED: at the start of day N you are
  // expected to have spent N−1 days' worth, and counting today as elapsed
  // reads every untouched morning as a saving.
  const completed = Math.max(0, args.daysElapsed - 1);
  const variance = planned * completed - spent;

  const remaining = budget - spent;
  const strict = remaining / daysLeft;

  /*
   * Move only PART of the way from the plan toward the strict figure.
   *
   * `strict` already spreads the whole gap across every remaining day, and it
   * is brutal on arrival: overspend 300 against a 40 plan and tomorrow drops
   * to a number nobody holds, so the plan is abandoned and the app with it.
   * Applying a fraction of that correction today leaves the rest to the days
   * behind it, which is how a person actually recovers from one expensive
   * afternoon.
   *
   * The fraction is the smoothing window measured against the days remaining,
   * which gives the behaviour worth having at both ends of the month: early
   * on, when there is plenty of room, today barely moves; as the month closes
   * and the window covers what is left, it converges on the exact figure. No
   * pretending near payday, no panic on the 3rd.
   *
   * It is symmetric by construction — underspending makes the gap positive and
   * raises the days that follow, so saved money becomes capacity rather than
   * quietly disappearing.
   */
  const alpha = Math.min(1, window / daysLeft);
  const beforeFloor = planned + (strict - planned) * alpha;

  /*
   * The floor is absolute and the goal pays for honouring it. A month can be
   * overspent past the point any daily figure recovers it; the honest response
   * is to keep the person fed and let the goal take the loss, with the amount
   * named rather than hidden.
   */
  const today = Math.max(args.range.min, Number.isFinite(beforeFloor) ? beforeFloor : planned);
  const absorbed = Math.max(0, (args.range.min - beforeFloor) * daysLeft);

  const span = args.range.comfort - args.range.min;

  return {
    planned,
    strict,
    today,
    variance,
    freed: Math.max(0, variance),
    absorbed,
    remaining,
    daysLeft,
    onTrack: variance >= 0,
    position: span > 0 ? Math.min(1, Math.max(0, (today - args.range.min) / span)) : today > 0 ? 1 : 0,
  };
}
