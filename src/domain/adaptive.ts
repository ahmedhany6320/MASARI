import { isEgpGoal } from './goals';
import type { Capacity } from './goalPlan';
import type { Goal } from './types';

/**
 * Adaptive goal planning.
 *
 * The fixed-deadline planner has an honesty problem: hold both the target and
 * the date still, and the arithmetic will happily demand that someone live on
 * seventeen dirhams a day. That number is correct and useless — a plan nobody
 * can follow is not a plan, and an app that prints it gets deleted.
 *
 * So the priority is inverted. The LIVING FLOOR is the fixed quantity, because
 * it is the one with a real-world constraint underneath it, and the GOAL is
 * what stretches. Concretely:
 *
 *   - the user declares the least they can genuinely live on per day
 *   - that floor is protected before the goal takes anything
 *   - whatever remains above the floor goes to the goal
 *   - the goal's date and reachable amount are then DERIVED, and re-derived
 *     every day from what was actually spent
 *
 * The original target is never discarded — it stays on screen as the
 * aspiration, with the honest gap shown against it. Which is the difference
 * between "you will not make it" and "at this rate you land here; spend 6/day
 * less and you land there instead".
 */

/** How the living floor and the goal were reconciled this cycle. */
export interface Reservation {
  /** What the goal schedule asked for, in the salary currency. */
  requested: number;
  /** What is actually set aside after protecting the floor. */
  reserved: number;
  /** How much the floor held back. */
  heldBack: number;
  /** True when the floor forced the goal to take less. */
  capped: boolean;
  /** The floor itself, per month. */
  floorMonthly: number;
}

/**
 * Reconciles a goal's monthly demand against the living floor.
 *
 * This is the whole idea in one function: the goal may only take what is left
 * once the floor is safe. When that is less than the schedule wanted, the goal
 * slips — which is the correct outcome, because the alternative is a daily
 * limit nobody can live inside.
 */
export function reserveForGoal(
  requested: number,
  poolBeforeGoal: number,
  minDaily: number,
  daysInMonth: number,
): Reservation {
  const floorMonthly = Math.max(0, minDaily) * daysInMonth;
  // Never negative: if the floor already exceeds the pool there is simply
  // nothing to reserve, and the shortfall is a spending problem, not a goal one.
  const available = Math.max(0, poolBeforeGoal - floorMonthly);
  const reserved = Math.min(Math.max(0, requested), available);
  return {
    requested,
    reserved,
    heldBack: Math.max(0, requested - reserved),
    capped: reserved < requested,
    floorMonthly,
  };
}

export interface AdaptiveOutlook {
  goalId: string;
  currency: 'AED' | 'EGP';
  /** The number the user actually asked for. Never overwritten. */
  aspiration: number;
  held: number;

  /** The declared living floor. */
  minDailyAed: number;
  floorMonthlyAed: number;

  /**
   * The most that can be saved per month while still living at the floor.
   * This is the ceiling on any realistic plan.
   */
  maxSavingAed: number;
  maxSavingGoal: number;

  /** Saving implied by what is actually being spent right now. */
  paceSavingAed: number;
  paceSavingGoal: number;

  /** Months to the aspiration if every spare dirham above the floor is saved. */
  monthsAtMax: number | null;
  /** Months to the aspiration at the pace actually being kept. */
  monthsAtPace: number | null;

  /** False when even living at the floor saves nothing. */
  viable: boolean;
}

function heldIn(goal: Goal, fx: number): number {
  return isEgpGoal(goal) ? goal.alloc * fx + (goal.extEgp ?? 0) : goal.alloc;
}

function toGoal(goal: Goal, aed: number, fx: number): number {
  return isEgpGoal(goal) ? aed * fx : aed;
}

export function adaptiveOutlook(
  goal: Goal,
  capacity: Capacity,
  minDailyAed: number,
  fx: number,
): AdaptiveOutlook {
  const aspiration = goal.target ?? 0;
  const held = heldIn(goal, fx);
  const remaining = Math.max(0, aspiration - held);

  const floorMonthlyAed = Math.max(0, minDailyAed) * capacity.daysInMonth;
  const maxSavingAed = Math.max(0, capacity.poolBeforeGoal - floorMonthlyAed);
  const paceSavingAed = Math.max(0, capacity.saving);

  const maxSavingGoal = toGoal(goal, maxSavingAed, fx);
  const paceSavingGoal = toGoal(goal, paceSavingAed, fx);

  const months = (perMonth: number): number | null =>
    remaining <= 0 ? 0 : perMonth > 0 ? remaining / perMonth : null;

  return {
    goalId: goal.id,
    currency: isEgpGoal(goal) ? 'EGP' : 'AED',
    aspiration,
    held,
    minDailyAed,
    floorMonthlyAed,
    maxSavingAed,
    maxSavingGoal,
    paceSavingAed,
    paceSavingGoal,
    monthsAtMax: months(maxSavingGoal),
    monthsAtPace: months(paceSavingGoal),
    viable: maxSavingAed > 0,
  };
}

/** What a chosen horizon actually delivers, under the adaptive rules. */
export interface AdaptiveHorizon {
  months: number;
  /** Reachable while living at the floor — the realistic ceiling. */
  best: number;
  /** Reachable at the pace actually being kept. */
  likely: number;
  /** `likely` as a share of the aspiration. */
  progress: number;
  /** Aspiration minus `likely`. */
  gap: number;
  /** True when the aspiration is genuinely reachable in this window. */
  reachesAspiration: boolean;
  /**
   * The number worth actually committing to: the aspiration when it fits,
   * otherwise the honest best case. This is what turns a target the user will
   * fail against into one they can hit.
   */
  suggestedTarget: number;
}

export function adaptiveHorizon(
  outlook: AdaptiveOutlook,
  months: number,
): AdaptiveHorizon {
  const best = outlook.held + outlook.maxSavingGoal * months;
  const likely = outlook.held + outlook.paceSavingGoal * months;
  const reaches = best >= outlook.aspiration && outlook.aspiration > 0;

  return {
    months,
    best,
    likely,
    progress: outlook.aspiration > 0 ? Math.min(1, likely / outlook.aspiration) : 0,
    gap: Math.max(0, outlook.aspiration - likely),
    reachesAspiration: reaches,
    suggestedTarget: reaches ? outlook.aspiration : best,
  };
}

/**
 * The daily allowance implied by aiming at `targetAmount` within `months`,
 * with the floor protected.
 *
 * Returns null when the target cannot be met even by living exactly at the
 * floor — the caller should then show the reachable figure instead of a
 * spending limit that would have to be negative.
 */
export function dailyForTarget(
  goal: Goal,
  targetAmount: number,
  months: number,
  capacity: Capacity,
  minDailyAed: number,
  fx: number,
): number | null {
  const remaining = Math.max(0, targetAmount - heldIn(goal, fx));
  const perMonthGoal = remaining / Math.max(1, months);
  const perMonthAed = isEgpGoal(goal) ? perMonthGoal / fx : perMonthGoal;

  const livingAed = capacity.poolBeforeGoal - perMonthAed;
  const daily = livingAed / capacity.daysInMonth;

  // Below the floor the plan is fiction, so say so rather than printing it.
  return daily >= minDailyAed ? daily : null;
}

export interface DriftStatus {
  /** Spending pace this cycle, per day. */
  actualDaily: number;
  /** The daily figure the adopted plan assumes. */
  plannedDaily: number;
  /** Positive means overspending against plan. */
  driftDaily: number;
  /** That drift compounded across the whole month. */
  driftMonthly: number;
  /** How the goal date moves as a result, in months. Positive is later. */
  monthsSlip: number | null;
  onTrack: boolean;
}

/**
 * Live drift against the adopted plan, recomputed from real spending.
 *
 * This is what makes the plan feel alive rather than a form filled in once: an
 * expensive Tuesday visibly pushes the goal date out, and a quiet week pulls it
 * back in.
 */
export function planDrift(
  outlook: AdaptiveOutlook,
  plannedDaily: number,
  actualDaily: number,
  capacity: Capacity,
  months: number,
): DriftStatus {
  const driftDaily = actualDaily - plannedDaily;
  const driftMonthly = driftDaily * capacity.daysInMonth;

  const remaining = Math.max(0, outlook.aspiration - outlook.held);
  const plannedSavingAed = capacity.poolBeforeGoal - plannedDaily * capacity.daysInMonth;
  const actualSavingAed = capacity.poolBeforeGoal - actualDaily * capacity.daysInMonth;

  // Convert through the outlook's own AED→goal ratio, so currency handling
  // lives in exactly one place instead of being re-derived here.
  const ratio = outlook.maxSavingAed > 0 ? outlook.maxSavingGoal / outlook.maxSavingAed : 1;
  const toMonths = (savingAed: number): number | null => {
    const inGoal = savingAed * ratio;
    return inGoal > 0 ? remaining / inGoal : null;
  };

  const plannedMonths = toMonths(plannedSavingAed);
  const actualMonths = toMonths(actualSavingAed);

  return {
    actualDaily,
    plannedDaily,
    driftDaily,
    driftMonthly,
    monthsSlip:
      plannedMonths != null && actualMonths != null ? actualMonths - plannedMonths : null,
    onTrack: driftDaily <= 0,
  };
}

/**
 * How a goal is being pursued.
 *
 * - `fixed`    hold the amount AND the date, reserve whatever that demands.
 *              Honest but brittle: an ambitious pair can drive daily spending
 *              to nothing, which is why the floor caps it.
 * - `stretch`  hold the AMOUNT, protect the floor, let the DATE move.
 * - `horizon`  hold the DATE, protect the floor, let the AMOUNT move — the
 *              landing figure is derived and re-derived every day.
 */
export type GoalMode = 'fixed' | 'stretch' | 'horizon';

/** Average month length, for converting a date gap into fractional months. */
const MONTH_MS = 30.4375 * 864e5;

export interface HorizonTracker {
  goalId: string;
  currency: 'AED' | 'EGP';
  /** The date being held fixed. */
  targetDate: Date;
  /** Whole months the plan was set up with. */
  months: number;
  /**
   * Months still to run, fractional. Shrinks every day, which is what makes
   * the landing figure move without anything else changing.
   */
  monthsRemaining: number;

  held: number;
  /** Landing figure at the pace actually being kept. THE number. */
  projected: number;
  /** Landing figure if every remaining day spends exactly the floor. */
  projectedAtFloor: number;
  /** Landing figure if nothing more were spent at all — the ceiling. */
  projectedIfNoSpend: number;

  /** The original ambition, kept in view. */
  aspiration: number;
  /** Aspiration minus projected. Zero when the goal is met. */
  gap: number;
  progress: number;
  reachesAspiration: boolean;

  /**
   * What today has done to the landing figure: positive when today's spending
   * came in under its allowance and pushed the projection up.
   */
  todayImpact: number;
  /** What one dirham saved per day adds by the target date. */
  perDirhamPerDay: number;
}

/**
 * Fixed-date tracking: hold the deadline, let the amount tell the truth.
 *
 * This is the mode for someone who knows WHEN they need the money and wants to
 * know how much they will actually have — rather than being told a fixed
 * amount is unreachable and left with nothing to act on.
 *
 * The figure genuinely moves day to day: `monthsRemaining` shrinks with the
 * calendar, and the pace is recomputed from real spending, so an expensive
 * weekend visibly lowers the landing figure and a quiet week raises it.
 */
export function horizonTracker(
  goal: Goal,
  capacity: Capacity,
  minDailyAed: number,
  months: number,
  fx: number,
  now: Date,
  /** Spending recorded today, for the impact figure. */
  spentToday = 0,
  /** Today's allowance, for the impact figure. */
  allowanceToday = 0,
): HorizonTracker {
  const outlook = adaptiveOutlook(goal, capacity, minDailyAed, fx);

  const targetDate = new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
  const monthsRemaining = Math.max(0, (targetDate.getTime() - now.getTime()) / MONTH_MS);

  const projected = outlook.held + outlook.paceSavingGoal * monthsRemaining;
  const projectedAtFloor = outlook.held + outlook.maxSavingGoal * monthsRemaining;
  const poolAsGoal =
    outlook.maxSavingAed > 0
      ? (outlook.maxSavingGoal / outlook.maxSavingAed) * capacity.poolBeforeGoal
      : 0;
  const projectedIfNoSpend = outlook.held + poolAsGoal * monthsRemaining;

  // One dirham a day, saved from now until the date, in the goal's currency.
  const ratio = outlook.maxSavingAed > 0 ? outlook.maxSavingGoal / outlook.maxSavingAed : 1;
  const perDirhamPerDay = ratio * capacity.daysInMonth * monthsRemaining;

  // Coming in under today's allowance is money that goes to the goal instead.
  const todayImpact = (allowanceToday - spentToday) * ratio;

  const aspiration = outlook.aspiration;
  return {
    goalId: goal.id,
    currency: outlook.currency,
    targetDate,
    months,
    monthsRemaining,
    held: outlook.held,
    projected,
    projectedAtFloor,
    projectedIfNoSpend,
    aspiration,
    gap: Math.max(0, aspiration - projected),
    progress: aspiration > 0 ? Math.min(1, projected / aspiration) : 0,
    reachesAspiration: aspiration > 0 && projected >= aspiration,
    todayImpact,
    perDirhamPerDay,
  };
}
