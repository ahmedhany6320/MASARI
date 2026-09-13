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

/*
 * WHAT THIS FILE USED TO HOLD, AND WHY IT NO LONGER DOES
 *
 * Five more exported functions lived here: `reserveForGoal`,
 * `adaptiveHorizon`, `dailyForTarget`, `planDrift` and `horizonTracker`.
 * Every one of them independently answered some version of "where does this
 * goal land, and what does that cost per day" — and not one of them had a
 * caller left. They were reached only by their own tests.
 *
 * That is exactly how this app came to print 433,894, 409,958, 407,261, null
 * and NaN for one question, two of them on the same screen. Dead code that
 * answers a live question is not inert: it is the next divergence, waiting
 * for someone to wire it back up because it is right there and looks correct.
 *
 * The projection in `projection.ts` answers all of it now, from one
 * simulation. What survives here is `adaptiveOutlook`, which the goal screen
 * still reads, and `GoalMode`, which is a stored user preference.
 */

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
