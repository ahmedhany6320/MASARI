import { toAed } from './goals';
import type { Goal } from './types';

/**
 * Where the money actually sitting in the bank is doing its work.
 *
 * A goal's progress used to be a number typed by hand into `alloc`, with an
 * `auto` flag beside it that nothing ever read. That leaves the one question
 * that matters unanswered: the balance is real money, and the goals are claims
 * on it, so the app should be able to say which claim each dirham is serving
 * without being told twice.
 *
 * An AUTO goal draws from the balance itself — save money into your account
 * and the goal fills up, with nothing to record. A MANUAL goal keeps the
 * figure the user declared, for money held somewhere this app cannot see.
 *
 * The balance is handed to auto goals in declaration order and runs out where
 * it runs out, which is a truthful statement about priority; spreading a
 * shortfall evenly would report every goal as partly funded when the honest
 * answer is that the early ones are funded and the last one is not.
 */
export interface GoalFunding {
  goal: Goal;
  /** Money in the salary currency standing behind this goal. */
  held: number;
  /** True when `held` was drawn from the balance rather than declared. */
  fromBalance: boolean;
  /** What the goal asked for: its declared alloc, or its remaining need. */
  wanted: number;
  /** How far short of `wanted` the balance fell. */
  short: number;
}

export interface FundingPlan {
  goals: GoalFunding[];
  /** Balance not claimed by any goal. */
  free: number;
  /** Total standing behind goals. */
  funded: number;
  /** Total the goals asked for. */
  wanted: number;
  /** Balance available to draw on. */
  liquid: number;
  /**
   * True when goals stand for more money than the account holds. Only a
   * manual goal can cause this — an auto one cannot claim what is not there —
   * and it is reported rather than corrected, because the user may well be
   * holding the difference somewhere this app cannot see.
   */
  overAllocated: boolean;
  /** Share of the balance drawn by auto goals, 0–1. */
  ratio: number;
}

/**
 * `liquid` is bank plus cash only — never card headroom. A goal "funded" by a
 * credit limit is funded by debt.
 */
export function fundGoals(goals: Goal[], liquid: number, fx: number): FundingPlan {
  let left = Math.max(0, liquid);

  const out = goals.map((g): GoalFunding => {
    if (!g.auto) {
      /*
       * Declared by hand and taken at face value, uncapped and without
       * touching the balance. Manual is what you choose when the money sits
       * somewhere this app cannot see — cash at home, another bank — so
       * clamping it to the visible balance would report savings as missing
       * purely because they are held elsewhere. Whether the total is backed is
       * `allocationCheck`'s question, answered in one place rather than
       * half-answered in two.
       */
      const wanted = Math.max(0, g.alloc);
      return { goal: g, held: wanted, fromBalance: false, wanted, short: 0 };
    }

    /*
     * An auto goal draws what it still needs, not everything in reach — once
     * it is fully funded the rest of the balance moves on to the next goal.
     * Money already sitting in Egypt counts toward the Egypt target and is not
     * asked for again from the bank.
     */
    const targetAed = g.target != null ? toAed(g, g.target, fx) : null;
    const externalAed = g.extEgp != null && g.extEgp > 0 ? g.extEgp / fx : 0;
    const wanted =
      targetAed != null ? Math.max(0, targetAed - externalAed) : left;

    const held = Math.min(wanted, left);
    left -= held;
    return { goal: g, held, fromBalance: true, wanted, short: wanted - held };
  });

  const have = Math.max(0, liquid);
  const funded = out.reduce((a, x) => a + x.held, 0);

  return {
    goals: out,
    free: left,
    funded,
    wanted: out.reduce((a, x) => a + x.wanted, 0),
    liquid: have,
    overAllocated: funded > have,
    ratio: have > 0 ? Math.min(1, (have - left) / have) : 0,
  };
}

/** What a single goal holds under the plan, in the salary currency. */
export function heldFor(plan: FundingPlan, goalId: string): number {
  return plan.goals.find((x) => x.goal.id === goalId)?.held ?? 0;
}
