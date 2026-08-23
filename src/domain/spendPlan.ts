import { isEgpGoal, toAed } from './goals';
import type { Goal } from './types';

/**
 * The goal-driven spending plan.
 *
 * Every other mode in this app treats the goal as a CLAIM: it takes its
 * monthly slice off the salary, and whatever survives gets divided by the days
 * left to produce a daily limit. That answers "what may I spend given my
 * goal", and it has two problems. The daily figure moves every time anything
 * else moves, so it never feels like a commitment; and when the goal is
 * unreachable the arithmetic quietly drives the limit toward zero.
 *
 * This inverts it. The DURATION is fixed by the user, the DAILY SPEND is the
 * lever, and the goal is the OUTCOME:
 *
 *     spend this much a day  →  this much is left over each month
 *                            →  the goal lands here after N months
 *
 * So the app can say "spend 61 a day and you arrive on target", or, when no
 * livable figure reaches the target, "the most you can do is spend the floor,
 * and that lands you at 888,960 of 1,100,000". The target is never rewritten;
 * it stays as the aspiration with the honest gap beside it.
 *
 * The daily figure that comes out is FIXED for the cycle. It is not
 * re-divided as days pass, because the whole point is a number you can hold
 * yourself to. Overspending does not raise tomorrow's limit — it lowers where
 * the goal lands, and the projection says so.
 */

export type SpendSource =
  /** The target is reachable; this is the spend that gets there exactly. */
  | 'target'
  /** The target is out of reach; spending sits at the declared living floor. */
  | 'floor'
  /** Even the floor is unaffordable; spending is everything there is. */
  | 'pool';

export interface SpendPlan {
  goalId: string;
  /** Months the plan is held to. */
  months: number;

  /** The daily figure the plan commits to. This IS the limit. */
  dailyAllowance: number;
  /** Where that figure came from. */
  source: SpendSource;
  /** The declared living floor, per day. Zero when none is set. */
  floorDaily: number;

  /** Left for the goal each month once that spending is honoured. */
  monthlyToGoal: number;
  /** Where the goal lands after `months`, in the goal's own currency. */
  projected: number;
  /** The aspiration, exactly as the user set it. */
  target: number;
  /** How far `projected` falls short. Zero when it arrives. */
  gap: number;
  reachesTarget: boolean;
  /** Progress toward the aspiration, 0–1. */
  progress: number;

  /**
   * The daily spend that would land exactly on target. Null when that figure
   * is below the living floor, which is the app's definition of unreachable.
   */
  dailyForTarget: number | null;
  /** True when no livable daily spend reaches the target in this time. */
  impossible: boolean;

  /** What one dirham a day less, sustained, adds to the landing figure. */
  perDirhamPerDay: number;
}

export interface PlanInputs {
  /** Salary (or balance) less commitments, transfers and card dues. */
  poolBeforeGoal: number;
  daysInMonth: number;
  /** What the goal already holds, in the salary currency. */
  heldAed: number;
  /** Least the user can genuinely live on per day. */
  floorDaily: number;
  fx: number;
}

/**
 * Builds the plan for one goal held to a fixed horizon.
 *
 * Returns null for a goal with no target or no duration: there is nothing to
 * steer by, and inventing a horizon would be worse than declining to plan.
 */
export function spendPlan(goal: Goal, inp: PlanInputs): SpendPlan | null {
  if (goal.target == null || goal.target <= 0 || !goal.months || goal.months <= 0) return null;

  const { poolBeforeGoal, daysInMonth, heldAed, fx } = inp;
  const months = goal.months;
  const floorDaily = Math.max(0, inp.floorDaily);
  const egp = isEgpGoal(goal);

  const pool = Math.max(0, poolBeforeGoal);
  const targetAed = toAed(goal, goal.target, fx);
  const remainingAed = Math.max(0, targetAed - heldAed);
  const neededMonthly = remainingAed / months;

  // What would be left to live on if the target were met exactly.
  const dailyIfTarget = (pool - neededMonthly) / daysInMonth;
  const reachable = dailyIfTarget >= floorDaily && dailyIfTarget >= 0;

  let dailyAllowance: number;
  let source: SpendSource;
  if (reachable) {
    dailyAllowance = dailyIfTarget;
    source = 'target';
  } else if (floorDaily * daysInMonth <= pool) {
    // Out of reach, so the floor holds and the GOAL gives way — never the
    // other way round. This is the adaptive case.
    dailyAllowance = floorDaily;
    source = 'floor';
  } else {
    // The floor itself is unaffordable this month. Spending everything is the
    // honest answer; the goal simply receives nothing.
    dailyAllowance = pool / daysInMonth;
    source = 'pool';
  }

  const monthlyToGoal = Math.max(0, pool - dailyAllowance * daysInMonth);
  const projectedAed = heldAed + monthlyToGoal * months;
  const projected = egp ? projectedAed * fx : projectedAed;

  const gap = Math.max(0, goal.target - projected);

  return {
    goalId: goal.id,
    months,
    dailyAllowance,
    source,
    floorDaily,
    monthlyToGoal,
    projected,
    target: goal.target,
    gap,
    // A hair of tolerance: floating point should not turn arriving exactly on
    // target into a one-pound shortfall.
    reachesTarget: gap <= Math.max(1, goal.target * 1e-9),
    progress: goal.target > 0 ? Math.min(1, projected / goal.target) : 0,
    dailyForTarget: dailyIfTarget >= floorDaily && dailyIfTarget >= 0 ? dailyIfTarget : null,
    impossible: !reachable,
    // Spending one less per day for the whole horizon, expressed in the goal's
    // own currency — the unit that makes a small cut feel worth making.
    perDirhamPerDay: (egp ? fx : 1) * daysInMonth * months,
  };
}

/**
 * Picks the goal that steers spending: the first with both a target and a
 * duration. Ordering is the user's, so it doubles as a statement of priority.
 */
export function steeringGoal(goals: Goal[]): Goal | null {
  return goals.find((g) => g.target != null && g.target > 0 && !!g.months && g.months > 0) ?? null;
}

/**
 * Where the goal actually lands given what has REALLY been spent this cycle,
 * rather than what the plan assumed.
 *
 * This is what makes the plan live: underspend today and the landing figure
 * rises, overspend and it falls, re-derived every time the ledger changes.
 */
export function projectAtPace(
  plan: SpendPlan,
  goal: Goal,
  heldAed: number,
  actualMonthlySpend: number,
  poolBeforeGoal: number,
  fx: number,
): number {
  const toGoal = Math.max(0, Math.max(0, poolBeforeGoal) - Math.max(0, actualMonthlySpend));
  const aed = heldAed + toGoal * plan.months;
  return isEgpGoal(goal) ? aed * fx : aed;
}
