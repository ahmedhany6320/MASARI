import type { Goal } from './types';

/**
 * A goal is EGP-denominated when it says so, or — for ledgers written by the
 * prototype, which had no `currency` field — when its id is the Egypt goal.
 */
export function isEgpGoal(g: Goal): boolean {
  return g.currency ? g.currency === 'EGP' : g.id === 'egypt';
}

/** Converts an amount denominated in the goal's currency into AED. */
export function toAed(g: Goal, amount: number, fx: number): number {
  return isEgpGoal(g) ? amount / fx : amount;
}

/**
 * What this goal needs set aside per month, in the salary currency (AED), to
 * land on target on schedule.
 *
 * A goal with no target or no deadline demands nothing — it is a wish, not a
 * commitment, and must not eat into the daily spend limit. EGP targets and any
 * money already sitting in Egypt are converted at `fx` before the shortfall is
 * spread across the remaining months.
 */
export function goalMonthlyRequirement(g: Goal, fx: number, heldAed?: number): number {
  if (!g.target || !g.months) return 0;
  const egp = isEgpGoal(g);
  const targetAed = egp ? g.target / fx : g.target;
  // `heldAed` lets a caller pass what the BALANCE actually holds for this goal
  // instead of the declared figure. An auto goal has no declared figure worth
  // reading, so without this its requirement would ignore every dirham already
  // saved and demand the full target over again.
  const currentAed = (heldAed ?? g.alloc) + (egp ? (g.extEgp ?? 0) / fx : 0);
  return Math.max(0, (targetAed - currentAed) / g.months);
}

/**
 * Combined monthly savings requirement across every goal.
 *
 * `held` resolves what each goal actually has behind it; omitted, the declared
 * `alloc` is used, which is what every caller predating auto-funding wants.
 */
export function goalsMonthlyRequirement(
  goals: Goal[],
  fx: number,
  held?: (g: Goal) => number,
): number {
  return goals.reduce((a, g) => a + goalMonthlyRequirement(g, fx, held?.(g)), 0);
}
