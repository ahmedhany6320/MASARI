import type { Goal } from './types';

/**
 * A goal is EGP-denominated when it says so, or — for ledgers written by the
 * prototype, which had no `currency` field — when its id is the Egypt goal.
 */
export function isEgpGoal(g: Goal): boolean {
  return g.currency ? g.currency === 'EGP' : g.id === 'egypt';
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
export function goalMonthlyRequirement(g: Goal, fx: number): number {
  if (!g.target || !g.months) return 0;
  const egp = isEgpGoal(g);
  const targetAed = egp ? g.target / fx : g.target;
  const currentAed = g.alloc + (egp ? (g.extEgp ?? 0) / fx : 0);
  return Math.max(0, (targetAed - currentAed) / g.months);
}

/** Combined monthly savings requirement across every goal. */
export function goalsMonthlyRequirement(goals: Goal[], fx: number): number {
  return goals.reduce((a, g) => a + goalMonthlyRequirement(g, fx), 0);
}
