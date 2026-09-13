import { isEgpGoal } from './goals';
import type { Goal } from './types';

/**
 * The daily control loop.
 *
 * Everything before this produced a plan and left it there. A plan that does
 * not answer back is a budget, and budgets fail the first time real life
 * disagrees with them. This closes the loop: every day the figure is re-derived
 * from what was ACTUALLY spent, and the consequence lands somewhere explicit
 * rather than being quietly absorbed.
 *
 * The rules it implements, in the order they take precedence:
 *
 *  1. SURVIVAL IS NOT NEGOTIABLE. The daily figure never falls below the band's
 *     floor. When arithmetic demands it should, the GOAL absorbs the deficit
 *     instead — and the app says so rather than printing a number nobody can
 *     live on.
 *  2. OVERSPENDING TIGHTENS THE REST OF THE MONTH, not the goal. Spend 200 on
 *     a 60 day and the remaining days share the 140, so the month still lands
 *     where it meant to.
 *  3. UNDERSPENDING IS SPLIT. Half is banked to the goal and cannot be spent
 *     again; half stays available. Banking all of it makes thrift feel like
 *     punishment; returning all of it means a careful week buys nothing.
 *  4. THE BAND HAS A TOP. Below it the month is being endured rather than
 *     lived, and that is worth naming even when nothing is technically wrong.
 */

export interface LivingBand {
  /** The least that is survivable in a day. Never breached. */
  min: number;
  /** A balanced day rather than a tight one. */
  comfort: number;
}

/** Normalises a band, tolerating the two figures being set the wrong way round. */
export function livingBand(min: number | null | undefined, comfort: number | null | undefined): LivingBand {
  const a = Math.max(0, min ?? 0);
  const b = Math.max(0, comfort ?? 0);
  // A comfort level below the floor is a data-entry slip, not an instruction
  // to live on less than the minimum.
  return b >= a ? { min: a, comfort: b } : { min: b, comfort: a };
}

/*
 * `adaptDaily` used to live here — a second daily control loop, with its own
 * zones, its own variance and its own share of underspend banked to the goal.
 *
 * It could not be reached. It was gated on exactly the same condition as the
 * projection, so the projection always answered first: it ran on every
 * evaluation and its result was discarded. Except that it had also been
 * feeding the goal's banked underspend, measured against a daily figure the
 * app had already stopped showing — so on one real ledger the goal was being
 * credited with savings against a plan of 254 a day while the user was shown
 * 50.
 *
 * `projection.dailyBudget` is the loop now. What survives here is
 * `livingBand`, which reads the declared range, and `adaptTarget`, which says
 * where a goal lands at a given monthly contribution.
 */

export type TargetDrift = 'restored' | 'raised' | 'lowered' | 'steady' | 'unreachable';

export interface TargetAdaptation {
  /** The aspiration, never rewritten. */
  original: number;
  /**
   * What this pace actually lands on, in the goal's currency. Recomputed every
   * day, so it rises on a careful week and falls on an expensive one.
   */
  achievable: number;
  /** What the app is currently steering toward: the achievable figure, capped. */
  adapted: number;
  /** True once the original is within reach again. */
  reachesOriginal: boolean;
  /** How far `adapted` sits below the aspiration. */
  shortfall: number;
  /** Which way it moved since the previous reading. */
  drift: TargetDrift;
  /** Share of the aspiration the adapted figure represents, 0–1. */
  progress: number;
}

/**
 * Re-derives what the goal is actually worth at the current pace.
 *
 * The aspiration is never overwritten. What moves is the figure the app steers
 * by, and it moves in BOTH directions — a windfall or a frugal month restores
 * ground that an expensive one gave up. A target that only ever ratchets down
 * is a scoreboard for failure.
 *
 * `previousAdapted` exists only to describe the direction of travel; nothing
 * depends on it, so a caller without history can omit it.
 */
export function adaptTarget(
  goal: Goal,
  monthlyToGoal: number,
  months: number,
  heldAed: number,
  fx: number,
  previousAdapted?: number | null,
): TargetAdaptation {
  const original = Math.max(0, goal.target ?? 0);
  const egp = isEgpGoal(goal);

  const achievableAed = Math.max(0, heldAed) + Math.max(0, monthlyToGoal) * Math.max(0, months);
  const achievable = egp ? achievableAed * fx : achievableAed;

  const reachesOriginal = original > 0 && achievable >= original;
  // Capped at the aspiration: overshooting the goal is not a bigger goal, it
  // is money left over, and reporting it as a raised target would be a lie.
  const adapted = original > 0 ? Math.min(achievable, original) : achievable;

  let drift: TargetDrift;
  if (original <= 0) drift = 'steady';
  else if (reachesOriginal) drift = previousAdapted != null && previousAdapted < original ? 'restored' : 'steady';
  else if (previousAdapted == null) drift = 'unreachable';
  else if (adapted > previousAdapted + 1) drift = 'raised';
  else if (adapted < previousAdapted - 1) drift = 'lowered';
  else drift = 'steady';

  return {
    original,
    achievable,
    adapted,
    reachesOriginal,
    shortfall: Math.max(0, original - adapted),
    drift,
    progress: original > 0 ? Math.min(1, adapted / original) : 1,
  };
}
