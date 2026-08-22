import { isEgpGoal } from './goals';
import type { Goal } from './types';

/**
 * Goal planning.
 *
 * The previous version could only answer one question — "when, at this pace?"
 * — and when the pace was zero it said "never" and stopped. That is technically
 * true and practically useless: it tells you nothing about WHY, how far you
 * would actually get, or what would have to change.
 *
 * This module answers four questions instead:
 *
 *   1. Where do I land?      → `projectGoal` at any horizon
 *   2. Why can't I get there? → `GoalPlan.blocker`, with the numbers behind it
 *   3. What would it take?    → `requirementFor` a chosen deadline
 *   4. What are my options?   → `goalScenarios`, three honest plans
 *
 * Everything is pure and clock-injected, like the rest of the domain.
 */

/** Money available each month BEFORE any goal reservation. */
export interface Capacity {
  /** Salary minus commitments, planned transfers and card dues. */
  poolBeforeGoal: number;
  /** What is realistically spent on living, per month. */
  projectedSpend: number;
  /** `poolBeforeGoal − projectedSpend`. Can be negative. */
  saving: number;
  /** Days in the month used for the daily conversions. */
  daysInMonth: number;
}

export type GoalBlocker =
  | null
  /** No target set, so there is nothing to plan towards. */
  | 'no-target'
  /** Already reached. */
  | 'met'
  /** Spending equals or exceeds the pool, so nothing is being saved. */
  | 'no-capacity';

export interface GoalPlan {
  goalId: string;
  currency: 'AED' | 'EGP';
  /** In the goal's own currency. */
  target: number;
  held: number;
  remaining: number;
  /** 0–1. */
  progress: number;

  /** Saving capacity, expressed in the goal's currency. */
  savingPerMonth: number;
  savingPerMonthAed: number;

  blocker: GoalBlocker;
  /** Months at the current pace. Null when the pace never arrives. */
  monthsAtPace: number | null;
  eta: Date | null;

  /**
   * The hard floor: months required even if living spending were ZERO. No plan
   * can beat this, which is what makes an impossible deadline provably
   * impossible rather than merely discouraging.
   */
  floorMonths: number | null;

  /** The user's own deadline, when set. */
  targetMonths: number | null;
}

/** Where the goal actually stands after `months` at the current pace. */
export interface GoalProjectionAt {
  months: number;
  /** Total held at that point, in the goal's currency. */
  amount: number;
  progress: number;
  /** Still missing at that point. */
  shortfall: number;
  reached: boolean;
}

/** What hitting the goal by a chosen deadline actually demands. */
export interface GoalRequirement {
  months: number;
  /** Per month, in the goal's currency. */
  perMonth: number;
  /** Per month, in the salary currency. */
  perMonthAed: number;
  /** Extra needed on top of what is currently being saved. */
  gapAed: number;
  /** What is left to live on each month after reserving this. */
  livingLeftAed: number;
  /** That, divided across the month. */
  maxDailyAed: number;
  /** What is being spent daily right now. */
  currentDailyAed: number;
  /** Daily cut required. Zero or less means no cut needed. */
  dailyCutAed: number;
  /**
   * False when the reservation exceeds the entire pool — the deadline cannot
   * be met at any level of frugality.
   */
  feasible: boolean;
  /** True when it fits without changing spending at all. */
  comfortable: boolean;
}

function held(goal: Goal, fx: number): number {
  return isEgpGoal(goal) ? goal.alloc * fx + (goal.extEgp ?? 0) : goal.alloc;
}

/** Converts an amount in the salary currency into the goal's currency. */
function toGoal(goal: Goal, aed: number, fx: number): number {
  return isEgpGoal(goal) ? aed * fx : aed;
}

/** Converts an amount in the goal's currency into the salary currency. */
function toAed(goal: Goal, amount: number, fx: number): number {
  return isEgpGoal(goal) ? amount / fx : amount;
}

export function goalPlan(goal: Goal, capacity: Capacity, fx: number, now: Date): GoalPlan {
  const currency: 'AED' | 'EGP' = isEgpGoal(goal) ? 'EGP' : 'AED';
  const target = goal.target ?? 0;
  const have = held(goal, fx);
  const remaining = Math.max(0, target - have);

  const savingPerMonthAed = capacity.saving;
  const savingPerMonth = toGoal(goal, savingPerMonthAed, fx);

  // The floor uses the whole pool: it is what you could do spending nothing.
  const maxPerMonth = toGoal(goal, capacity.poolBeforeGoal, fx);
  const floorMonths = remaining <= 0 ? 0 : maxPerMonth > 0 ? remaining / maxPerMonth : null;

  let blocker: GoalBlocker = null;
  if (!goal.target) blocker = 'no-target';
  else if (remaining <= 0) blocker = 'met';
  else if (savingPerMonth <= 0) blocker = 'no-capacity';

  const monthsAtPace =
    remaining <= 0 ? 0 : savingPerMonth > 0 ? remaining / savingPerMonth : null;

  const eta =
    monthsAtPace == null
      ? null
      : new Date(now.getFullYear(), now.getMonth() + Math.ceil(monthsAtPace), now.getDate());

  return {
    goalId: goal.id,
    currency,
    target,
    held: have,
    remaining,
    progress: target > 0 ? Math.min(1, have / target) : 0,
    savingPerMonth,
    savingPerMonthAed,
    blocker,
    monthsAtPace,
    eta,
    floorMonths,
    targetMonths: goal.months,
  };
}

/**
 * Where the goal lands after a given number of months at the current pace.
 *
 * This is the answer to "so what DOES my money get me?" — far more useful than
 * a bare "you will not make it", because it turns a wall into a position.
 */
export function projectGoal(
  goal: Goal,
  capacity: Capacity,
  fx: number,
  months: number,
): GoalProjectionAt {
  const target = goal.target ?? 0;
  const have = held(goal, fx);
  const saved = Math.max(0, toGoal(goal, capacity.saving, fx)) * months;
  const amount = have + saved;
  return {
    months,
    amount,
    progress: target > 0 ? Math.min(1, amount / target) : 0,
    shortfall: Math.max(0, target - amount),
    reached: target > 0 && amount >= target,
  };
}

/**
 * What reaching the goal in `months` demands, and whether that is possible.
 *
 * `feasible` is the honest gate: if the monthly reservation exceeds the entire
 * pool, no amount of cutting back gets there and the app should say so rather
 * than presenting a target the user will fail against.
 */
export function requirementFor(
  goal: Goal,
  months: number,
  capacity: Capacity,
  fx: number,
): GoalRequirement {
  const target = goal.target ?? 0;
  const remaining = Math.max(0, target - held(goal, fx));
  const safeMonths = Math.max(1, months);

  const perMonth = remaining / safeMonths;
  const perMonthAed = toAed(goal, perMonth, fx);

  const livingLeftAed = capacity.poolBeforeGoal - perMonthAed;
  const maxDailyAed = livingLeftAed / capacity.daysInMonth;
  const currentDailyAed = capacity.projectedSpend / capacity.daysInMonth;

  return {
    months: safeMonths,
    perMonth,
    perMonthAed,
    gapAed: perMonthAed - capacity.saving,
    livingLeftAed,
    maxDailyAed,
    currentDailyAed,
    dailyCutAed: currentDailyAed - maxDailyAed,
    feasible: livingLeftAed > 0,
    comfortable: perMonthAed <= capacity.saving,
  };
}

export interface GoalScenario {
  /** Stable key the UI turns into a label. */
  id: 'fastest' | 'balanced' | 'comfortable';
  months: number;
  requirement: GoalRequirement;
}

/**
 * Three honest plans, always in the same order.
 *
 * - `fastest`     the floor: everything spare goes to the goal
 * - `balanced`    a real cut, roughly a quarter off current spending
 * - `comfortable` no change to spending at all
 *
 * Deliberately derived from the user's actual numbers rather than from round
 * durations, so every option shown is one they could genuinely choose.
 */
export function goalScenarios(goal: Goal, capacity: Capacity, fx: number): GoalScenario[] {
  const target = goal.target ?? 0;
  const remaining = Math.max(0, target - held(goal, fx));
  if (remaining <= 0) return [];

  const monthsFor = (savingAed: number): number | null => {
    const perMonth = toGoal(goal, savingAed, fx);
    return perMonth > 0 ? Math.ceil(remaining / perMonth) : null;
  };

  const fastest = monthsFor(capacity.poolBeforeGoal);
  const balanced = monthsFor(capacity.saving + capacity.projectedSpend * 0.25);
  const comfortable = monthsFor(capacity.saving);

  const out: GoalScenario[] = [];
  const push = (id: GoalScenario['id'], months: number | null) => {
    if (months == null || !Number.isFinite(months)) return;
    out.push({ id, months, requirement: requirementFor(goal, months, capacity, fx) });
  };

  push('fastest', fastest);
  push('balanced', balanced);
  push('comfortable', comfortable);

  // Collapse duplicates: when spending is already near zero all three
  // converge, and showing the same plan three times reads as a bug.
  return out.filter((s, i) => out.findIndex((o) => o.months === s.months) === i);
}
