import { posts } from './balances';
import type { Ledger, Tx } from './types';

/**
 * What it actually costs this person to live, measured rather than guessed.
 *
 * The living floor started as a number the user typed from memory, and that is
 * wrong in two ways that both end with an empty account.
 *
 * First, nobody knows their own floor. Asked to name the least they can live
 * on, people answer with an aspiration — and the goal engine then treats that
 * aspiration as a hard constraint and hands everything above it to the goal.
 *
 * Second, and worse: a daily floor is an AVERAGE, and spending is not average.
 * It arrives in a long tail of ordinary days and a short tail of expensive
 * ones — a repair, a doctor, a wedding. A floor of 60/day is not "enough to
 * live on" on the day something costs 400. The average is met and the money is
 * still not there, which is the failure that matters: an app that reports a
 * healthy plan while the account is empty is worse than no app.
 *
 * So this module measures two separate things from real history:
 *
 *   - the FLOOR, an ordinary day, set high enough that most days fit inside it
 *   - the BUFFER, a stock of cash sized from how far the bad days actually
 *     overshot — held back from the goal until it is full
 *
 * Both come out of the ledger. Neither is a guess.
 */

/** Spending totalled per calendar day, including days that saw nothing. */
export function dailyTotals(ledger: Pick<Ledger, 'tx'>, from: number, to: number): number[] {
  const byDay = new Map<string, number>();

  for (const x of ledger.tx) {
    if (x.type !== 'expense' || !posts(x as Tx)) continue;
    if (x.ts < from || x.ts > to) continue;
    const d = new Date(x.ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDay.set(key, (byDay.get(key) ?? 0) + x.amt);
  }

  /*
   * Days with no spending are counted as zeros rather than skipped. Dropping
   * them would measure "a day you spent something", and the floor has to cover
   * every day including the quiet ones — otherwise it is set from the busy
   * half of the month and comes out far too high.
   */
  const out: number[] = [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= to; t += 864e5) {
    const d = new Date(t);
    out.push(byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? 0);
  }
  return out;
}

/** Linear-interpolated percentile of an unsorted sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 1) return v[0] as number;
  const idx = (v.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return (v[lo] as number) * (1 - w) + (v[hi] as number) * w;
}

/**
 * Mean with the most extreme `trim` share of days discarded.
 *
 * The plain mean is dragged bodily upward by a single catastrophic day, which
 * is what percentiles exist to avoid. But a percentile collapses to zero under
 * sparse recording. Discarding the top tail before averaging keeps the mean's
 * immunity to empty days and the percentile's immunity to one bad one.
 */
export function trimmedMean(values: number[], trim = 0.05): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const drop = Math.min(v.length - 1, Math.floor(v.length * Math.max(0, trim)));
  const kept = drop > 0 ? v.slice(0, v.length - drop) : v;
  return kept.reduce((a, x) => a + x, 0) / kept.length;
}

export interface SpendProfile {
  /** Days of history the profile was measured over. */
  days: number;
  /** Days in that window with no spending at all. */
  quietDays: number;
  /**
   * Share of days carrying any record, 0–1.
   *
   * The figure that decides whether a per-day statistic means anything. A
   * quiet day and an unrecorded day look identical in a ledger, so when most
   * days are empty the percentiles describe recording habits rather than
   * spending, and collapse toward zero.
   */
  density: number;
  /** Total spent across the window. */
  total: number;
  /** Mean spend per day, including quiet days. */
  mean: number;
  /** Mean with the worst 5% of days discarded — the robust average. */
  steady: number;
  /** A genuinely ordinary day: half of days are under this. */
  typical: number;
  /** Three days in four fall under this. */
  comfortable: number;
  /** A bad day: nine days in ten fall under this. */
  bad: number;
  /** The single worst day observed. */
  worst: number;
  /** True when there is too little history to say anything honest. */
  thin: boolean;
}

/** The minimum history worth drawing a conclusion from. */
export const MIN_PROFILE_DAYS = 21;

/**
 * Below this share of days carrying an entry, per-day percentiles stop
 * describing spending and start describing how often the user opens the app.
 */
export const MIN_DENSITY = 0.4;

export function spendProfile(
  ledger: Pick<Ledger, 'tx'>,
  now: Date = new Date(),
  windowDays = 90,
): SpendProfile {
  const to = now.getTime();
  const from = to - windowDays * 864e5;
  const totals = dailyTotals(ledger, from, to);

  const total = totals.reduce((a, x) => a + x, 0);
  const quietDays = totals.filter((x) => x === 0).length;
  const spendingDays = totals.length - quietDays;

  return {
    days: totals.length,
    quietDays,
    density: totals.length > 0 ? spendingDays / totals.length : 0,
    total,
    mean: totals.length > 0 ? total / totals.length : 0,
    steady: trimmedMean(totals, 0.05),
    typical: percentile(totals, 0.5),
    comfortable: percentile(totals, 0.75),
    bad: percentile(totals, 0.9),
    worst: totals.length > 0 ? Math.max(...totals) : 0,
    /*
     * History exists but says nothing. Two ways that happens: too short a
     * window, or too few days in it carrying any entry — which cannot
     * distinguish "lives cheaply" from "has not been recording", and is the
     * far more common case.
     */
    thin:
      totals.length < MIN_PROFILE_DAYS ||
      spendingDays < 10 ||
      (totals.length > 0 && spendingDays / totals.length < MIN_DENSITY),
  };
}

export type FloorBasis = 'measured' | 'thin-history' | 'none';

export interface FloorAdvice {
  /** The daily floor this history supports. */
  floor: number;
  basis: FloorBasis;
  /** Share of days that fit inside `floor`, 0–1. */
  coverage: number;
  /** Days in the window that went over it. */
  daysOver: number;
  /**
   * Total overshoot above the floor across the window. This is the money a
   * flat daily floor silently fails to provide, and it is what the buffer is
   * sized from.
   */
  overflow: number;
  profile: SpendProfile;
}

/**
 * Recommends a daily floor from history.
 *
 * The 75th percentile, not the median. A floor at the median is met on exactly
 * half of days, which sounds reasonable and is not: it guarantees running
 * short every other day, and the shortfalls compound across a month. Three
 * days in four is tight enough to leave the goal something real and loose
 * enough that ordinary weeks do not breach it.
 */
export function recommendFloor(
  ledger: Pick<Ledger, 'tx'>,
  now: Date = new Date(),
  windowDays = 90,
): FloorAdvice {
  const profile = spendProfile(ledger, now, windowDays);
  const totals = dailyTotals(ledger, now.getTime() - windowDays * 864e5, now.getTime());

  if (profile.total <= 0) {
    return {
      floor: 0, basis: 'none', coverage: 0, daysOver: 0, overflow: 0, profile,
    };
  }

  /*
   * The 75th percentile, floored by the mean.
   *
   * The percentile alone is the right shape and the wrong answer under sparse
   * recording: when four days in five carry no entry, three-quarters of the
   * sample is zero and it recommends a floor of nothing — confidently, from
   * real data, and completely useless.
   *
   * A trimmed mean over the same window survives that, because the TOTAL is
   * right even when its attribution across days is lumpy — and discarding the
   * worst 5% keeps one catastrophic day from dragging the floor up with it.
   * Taking whichever is higher keeps the percentile's shape where recording is
   * dense and falls back to something defensible where it is not.
   */
  const floor = Math.max(profile.comfortable, profile.steady);
  const over = totals.filter((x) => x > floor);

  return {
    floor,
    basis: profile.thin ? 'thin-history' : 'measured',
    coverage: totals.length > 0 ? (totals.length - over.length) / totals.length : 0,
    daysOver: over.length,
    overflow: over.reduce((a, x) => a + (x - floor), 0),
    profile,
  };
}

export interface BufferAdvice {
  /** Cash that should be held liquid rather than committed to a goal. */
  target: number;
  /** What is currently free — liquid not already claimed by a goal. */
  held: number;
  /** Still to be set aside. Zero once the buffer is full. */
  shortfall: number;
  /** Monthly contribution to fill the remaining shortfall on schedule. */
  monthly: number;
  /** True when the buffer covers what history says it needs to. */
  funded: boolean;
  /** Share of the target already held, 0–1. */
  ratio: number;
  /** Months of ordinary spending the target covers. */
  monthsCovered: number;
}

/**
 * Sizes the cash reserve, and the rate it should be filled at.
 *
 * Two demands, and the larger wins.
 *
 * The first is VOLATILITY: the observed overshoot above the floor, scaled to a
 * month. That is a measured quantity — the exact money the daily floor did not
 * provide over the window — and it is the whole reason a flat floor is unsafe.
 *
 * The second is a FLOOR ON THE FLOOR: enough ordinary days to survive a month
 * where income is late or something large breaks. Volatility alone can size a
 * reserve at almost nothing for someone whose recorded spending happens to
 * have been smooth, which is a statement about the sample, not about risk.
 *
 * `fillMonths` spreads the shortfall rather than demanding it at once, because
 * a reserve that swallows the entire first month is one nobody keeps.
 */
export function recommendBuffer(
  advice: FloorAdvice,
  freeLiquid: number,
  daysInMonth: number,
  fillMonths = 6,
): BufferAdvice {
  const { profile, overflow } = advice;

  // Overshoot observed over the window, expressed per month.
  const volatility = profile.days > 0 ? (overflow / profile.days) * daysInMonth : 0;
  // One month of ordinary living, as the irreducible minimum.
  const minimum = advice.floor * daysInMonth;

  const target = Math.max(volatility, minimum);
  const held = Math.max(0, freeLiquid);
  const shortfall = Math.max(0, target - held);

  return {
    target,
    held,
    shortfall,
    monthly: shortfall / Math.max(1, fillMonths),
    funded: shortfall <= 0,
    ratio: target > 0 ? Math.min(1, held / target) : 1,
    monthsCovered: advice.floor > 0 ? target / (advice.floor * daysInMonth) : 0,
  };
}
