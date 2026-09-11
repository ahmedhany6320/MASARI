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

export type SpendZone =
  /** At or above a balanced day. */
  | 'comfort'
  /** Between the floor and a balanced day: liveable, but being endured. */
  | 'tight'
  /** Exactly at the floor — the goal is already absorbing the difference. */
  | 'floor'
  /** No band declared, so nothing to judge against. */
  | 'unset';

export interface DailyAdaptation {
  /** What is safe to spend today. The number the user acts on. */
  today: number;
  zone: SpendZone;
  /** Where `today` sits in the band, 0 at the floor and 1 at comfort. */
  bandPosition: number;

  /** Planned spending to date minus actual. Positive means ahead. */
  variance: number;
  /** Half of any underspend, moved to the goal and no longer spendable. */
  bankedToGoal: number;
  /** The month's living allocation after banking. */
  livingBudget: number;
  /** Of that, what is left. */
  remaining: number;
  daysLeft: number;
  daysElapsed: number;

  /**
   * Deficit the goal had to absorb because the floor held. Non-zero only when
   * the month has overrun far enough that honouring the floor costs the goal.
   */
  goalAbsorbed: number;

  /** The even pace the month was planned at, for comparison. */
  plannedDaily: number;
  /** What a balanced day would cost across the days that remain. */
  comfortDaily: number;
  /** True when spending is at or under plan. */
  onTrack: boolean;
}

export interface DailyInputs {
  /** The month's living allocation, before adaptation. */
  livingBudget: number;
  /** Spent so far this cycle. */
  spent: number;
  /** Days already elapsed in the cycle, at least 1. */
  daysElapsed: number;
  /** Days remaining including today, at least 1. */
  daysLeft: number;
  daysInMonth: number;
  band: LivingBand;
  /** Share of an underspend banked to the goal, 0–1. */
  bankShare?: number;
}

export function adaptDaily(inp: DailyInputs): DailyAdaptation {
  const daysElapsed = Math.max(1, inp.daysElapsed);
  const daysLeft = Math.max(1, inp.daysLeft);
  const budget = Math.max(0, inp.livingBudget);
  const spent = Math.max(0, inp.spent);
  const bankShare = Math.min(1, Math.max(0, inp.bankShare ?? 0.5));

  const plannedDaily = budget / Math.max(1, inp.daysInMonth);

  /*
   * Measured against days that have FINISHED, not including today.
   *
   * At the start of day N you are expected to have spent N−1 days' worth.
   * Counting today as elapsed treats every morning's untouched allowance as a
   * saving, banks half of it to the goal before a single purchase, and
   * reports a comfortable month as a tight one from the moment it opens.
   */
  const completedDays = Math.max(0, daysElapsed - 1);
  const plannedToDate = plannedDaily * completedDays;
  const variance = plannedToDate - spent;

  /*
   * Only an UNDERSPEND is banked. An overspend deliberately banks nothing:
   * taking it from the goal as well as from the remaining days would charge it
   * twice, and the whole point of rule 2 is that the month absorbs it.
   */
  const bankedToGoal = variance > 0 ? variance * bankShare : 0;
  const livingBudget = Math.max(0, budget - bankedToGoal);

  const remaining = livingBudget - spent;
  const even = remaining / daysLeft;

  // The floor is a hard stop. Where the even pace falls below it, the goal
  // pays the difference rather than the person.
  const today = Math.max(inp.band.min, even);
  const goalAbsorbed = Math.max(0, (inp.band.min - even) * daysLeft);

  const span = inp.band.comfort - inp.band.min;
  const zone: SpendZone =
    inp.band.comfort <= 0 && inp.band.min <= 0
      ? 'unset'
      : today >= inp.band.comfort
        ? 'comfort'
        : today > inp.band.min
          ? 'tight'
          : 'floor';

  return {
    today,
    zone,
    bandPosition: span > 0 ? Math.min(1, Math.max(0, (today - inp.band.min) / span)) : today > 0 ? 1 : 0,
    variance,
    bankedToGoal,
    livingBudget,
    remaining,
    daysLeft,
    daysElapsed,
    goalAbsorbed,
    plannedDaily,
    comfortDaily: inp.band.comfort,
    onTrack: variance >= 0,
  };
}

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
