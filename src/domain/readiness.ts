import { posts } from './balances';
import { spendProfile } from './floor';
import type { Ledger } from './types';

/**
 * Whether the data supports the conclusion.
 *
 * Analytics fail quietly. Given eleven spending days out of ninety-one, this
 * app will happily rank seven merchants, break spending into three categories,
 * fill all seven weekday buckets, and report last month as zero — every figure
 * arithmetically correct and every conclusion worthless. Worse, "last month:
 * 0" reads as "you spent nothing", when the truth is "you recorded nothing",
 * and the two are opposites.
 *
 * So each view declares what it needs and is told whether it has it. A view
 * that says "not enough yet" is more useful than one that invents a pattern,
 * because the second kind teaches people to distrust the whole screen.
 */

export type Confidence =
  /** Enough behind it to act on. */
  | 'good'
  /** Directionally useful, but thin. Shown with a warning. */
  | 'thin'
  /** Not enough to say anything. Hidden. */
  | 'insufficient';

export interface AnalyticsReadiness {
  /** Share of days in the window carrying any entry, 0–1. */
  density: number;
  recordedDays: number;
  totalDays: number;
  /** Spending entries in the window. */
  entries: number;
  /** Entries in the previous calendar month. */
  previousMonthEntries: number;
  overall: Confidence;
  merchants: Confidence;
  categories: Confidence;
  weekday: Confidence;
  monthCompare: Confidence;
  recurring: Confidence;
}

function grade(value: number, thin: number, good: number): Confidence {
  if (value >= good) return 'good';
  if (value >= thin) return 'thin';
  return 'insufficient';
}

export function analyticsReadiness(
  ledger: Pick<Ledger, 'tx'>,
  now: Date = new Date(),
  windowDays = 90,
): AnalyticsReadiness {
  const profile = spendProfile(ledger, now, windowDays);
  const from = now.getTime() - windowDays * 864e5;

  const entries = ledger.tx.filter(
    (x) => x.type === 'expense' && posts(x) && x.ts >= from,
  ).length;

  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const previousMonthEntries = ledger.tx.filter(
    (x) => x.type === 'expense' && posts(x) && x.ts >= prevStart && x.ts < prevEnd,
  ).length;

  const recordedDays = profile.days - profile.quietDays;

  return {
    density: profile.density,
    recordedDays,
    totalDays: profile.days,
    entries,
    previousMonthEntries,

    overall: grade(profile.density, 0.25, 0.5),

    // A ranking needs enough entries that the order is not an accident.
    merchants: grade(entries, 10, 25),
    categories: grade(entries, 8, 20),

    /*
     * The strictest of the group, and the one that misleads most readily.
     * Seven buckets divided into eleven entries is roughly one and a half per
     * weekday: whichever day comes out highest is noise, and it will be
     * reported as a habit.
     */
    weekday: grade(entries, 28, 56),

    // Comparing against a month nobody recorded reports a collapse in
    // spending that never happened.
    monthCompare: grade(previousMonthEntries, 5, 15),

    // A repeating charge cannot be distinguished from a coincidence without
    // several cycles behind it.
    recurring: grade(Math.min(entries, profile.days / 3), 20, 40),
  };
}
