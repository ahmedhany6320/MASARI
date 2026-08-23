import type { Goal } from './types';

/**
 * Goal allocations, checked against money that actually exists.
 *
 * `goal.alloc` was a number the user typed with nothing behind it: you could
 * earmark 50,000 toward a goal while holding 3,000, and the app would report
 * the goal half funded. An allocation is a claim on real cash, so it is only
 * meaningful next to the balance backing it.
 *
 * Nothing here rewrites what the user entered. Allocations stay exactly as
 * declared and the shortfall is reported instead — silently capping the figure
 * would destroy the record of what they intended to save.
 */
export interface AllocationCheck {
  /** Total earmarked across every goal, as declared. */
  allocated: number;
  /** Money actually held: bank plus cash. */
  liquid: number;
  /** Allocation genuinely covered by the balance. */
  backed: number;
  /** Allocation with no money behind it. Zero when the balance covers it. */
  unbacked: number;
  /** Balance not spoken for by any goal. */
  free: number;
  /** True when goals lay claim to more than exists. */
  overAllocated: boolean;
  /** Share of the balance already earmarked, 0–1. */
  ratio: number;
  /** Per goal, in declaration order. */
  perGoal: {
    goal: Goal;
    alloc: number;
    /** How much of THIS goal's allocation the balance covers. */
    backed: number;
    unbacked: number;
  }[];
}

/**
 * `liquid` is bank plus cash and never card headroom: credit is not savings,
 * and treating a limit as goal capital is how someone ends up "funding" a goal
 * with debt.
 */
export function allocationCheck(goals: Goal[], liquid: number): AllocationCheck {
  const allocated = goals.reduce((a, g) => a + Math.max(0, g.alloc), 0);
  const have = Math.max(0, liquid);
  const backed = Math.min(allocated, have);

  /*
   * Coverage is applied in declaration order rather than spread evenly. If the
   * balance covers two goals out of three, saying so is more useful than
   * telling the user all three are 67% funded — the shortfall is concentrated
   * somewhere real, and the order they set is the best available statement of
   * their priority.
   */
  let left = have;
  const perGoal = goals.map((g) => {
    const alloc = Math.max(0, g.alloc);
    const covered = Math.min(alloc, left);
    left -= covered;
    return { goal: g, alloc, backed: covered, unbacked: alloc - covered };
  });

  return {
    allocated,
    liquid: have,
    backed,
    unbacked: Math.max(0, allocated - have),
    free: Math.max(0, have - allocated),
    overAllocated: allocated > have,
    ratio: have > 0 ? Math.min(1, allocated / have) : allocated > 0 ? 1 : 0,
    perGoal,
  };
}
